import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  AmegoTransportError,
  createAmegoSignature,
  issueAmegoInvoice,
  queryAmegoInvoiceStatus,
  requestAmegoInvoicePrint,
  sanitizeAmegoResponse,
  type AmegoInvoiceRequest
} from "../src/amego";

const successFixture = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "tests/fixtures/amego-success.json"), "utf8")
) as Record<string, unknown>;

test("Amego signature matches the official Java example", () => {
  const data = '{"OrderId":"A20200817105934","BuyerIdentifier":"28080623","BuyerName":"光貿科技有限公司","NPOBAN":"","ProductItem":[{"Description":"測試商品1","Quantity":"1","UnitPrice":"170","Amount":"170","Remark":"","TaxType":"1"},{"Description":"會員折抵","Quantity":"1","UnitPrice":"-2","Amount":"-2","Remark":"","TaxType":"1"}],"SalesAmount":"160","FreeTaxSalesAmount":"0","ZeroTaxSalesAmount":"0","TaxType":"1","TaxRate":"0.05","TaxAmount":"8","TotalAmount":"168"}';
  assert.equal(
    createAmegoSignature(data, "1628136135", "sHeq7t8G1wiQvhAuIM27"),
    "efe84e2b95153a09df64a36e04e8ae1c"
  );
});

test("Amego client posts form data and normalizes nested success fields", async () => {
  let postedUrl = "";
  let postedForm: URLSearchParams | null = null;
  const result = await issueAmegoInvoice({
    invoice: "12345678",
    appKey: "test-app-key",
    data: invoiceRequest(),
    apiBaseUrl: "https://amego.test/json/",
    fetcher: async (input, init) => {
      postedUrl = String(input);
      postedForm = new URLSearchParams(String(init?.body));
      return Response.json({ code: 0, data: successFixture });
    }
  });

  assert.equal(postedUrl, "https://amego.test/json/f0401");
  assert.equal(postedForm?.get("invoice"), "12345678");
  assert.equal(postedForm?.get("data"), JSON.stringify(invoiceRequest()));
  assert.match(postedForm?.get("sign") ?? "", /^[0-9a-f]{32}$/);
  assert.equal(result.invoiceNumber, "AB12345678");
  assert.equal(result.qrcodeLeft, "MASKED-AMEGO-LEFT-PAYLOAD");
  assert.equal(result.qrcodeRight, "**MASKED-AMEGO-RIGHT-PAYLOAD");
});

test("Amego client returns business rejection without treating it as transport success", async () => {
  const result = await issueAmegoInvoice({
    invoice: "12345678",
    appKey: "masked-app-key",
    data: invoiceRequest(),
    fetcher: async () => Response.json({ code: 1001, msg: "invalid invoice data" })
  });

  assert.equal(result.code, "1001");
  assert.equal(result.message, "invalid invoice data");
  assert.equal(result.invoiceNumber, null);
});

test("Amego client distinguishes HTTP errors, timeouts, and incomplete responses", async () => {
  await assert.rejects(
    issueAmegoInvoice({
      invoice: "12345678",
      appKey: "masked-app-key",
      data: invoiceRequest(),
      fetcher: async () => new Response("upstream failed", { status: 503 })
    }),
    (error) => error instanceof AmegoTransportError
      && error.code === "amego_http_error"
      && error.status === 503
  );

  await assert.rejects(
    issueAmegoInvoice({
      invoice: "12345678",
      appKey: "masked-app-key",
      data: invoiceRequest(),
      fetcher: async () => { throw new DOMException("timed out", "AbortError"); }
    }),
    (error) => error instanceof AmegoTransportError && error.code === "amego_timeout"
  );

  const incomplete = await issueAmegoInvoice({
    invoice: "12345678",
    appKey: "masked-app-key",
    data: invoiceRequest(),
    fetcher: async () => Response.json({ code: 0, invoice_number: "AB12345678" })
  });
  assert.equal(incomplete.code, "0");
  assert.equal(incomplete.invoiceNumber, "AB12345678");
  assert.equal(incomplete.barcode, null);
  assert.equal(incomplete.qrcodeLeft, null);
  assert.equal(incomplete.qrcodeRight, null);
});

test("Amego invoice status posts an array and normalizes documented field variants", async () => {
  let postedUrl = "";
  let postedData: unknown;
  let postedTime = "";
  let postedSign = "";
  const result = await queryAmegoInvoiceStatus({
    invoice: "12345678",
    appKey: "test-app-key",
    invoiceNumber: "AB12345678",
    apiBaseUrl: "https://amego.test/json",
    fetcher: async (input, init) => {
      postedUrl = String(input);
      const form = new URLSearchParams(String(init?.body));
      postedData = JSON.parse(form.get("data") ?? "null") as unknown;
      postedTime = form.get("time") ?? "";
      postedSign = form.get("sign") ?? "";
      return Response.json({
        code: 0,
        data: [{
          invoice_number: "AB12345678",
          type: "C0401",
          status: "31",
          print_mark: "N",
          cancel_date: 0,
          wait: [{ type: "C0501" }]
        }]
      });
    }
  });

  assert.equal(postedUrl, "https://amego.test/json/invoice_status");
  assert.deepEqual(postedData, [{ InvoiceNumber: "AB12345678" }]);
  assert.match(postedTime, /^\d{10}$/);
  assert.equal(
    postedSign,
    createAmegoSignature(JSON.stringify(postedData), postedTime, "test-app-key")
  );
  assert.equal(result.invoiceNumber, "AB12345678");
  assert.equal(result.invoiceType, "C0401");
  assert.equal(result.invoiceStatus, 31);
  assert.equal(result.printMark, "N");
  assert.equal(result.cancelDate, "0");
  assert.deepEqual(result.waitingInvoiceTypes, ["C0501"]);

  const objectResult = await queryAmegoInvoiceStatus({
    invoice: "12345678",
    appKey: "test-app-key",
    invoiceNumber: "AB12345678",
    fetcher: async () => Response.json({
      code: "0",
      data: {
        invoice_number: "AB12345678",
        invoice_type: "C0401",
        invoice_status: 99,
        print_mark: "Y"
      }
    })
  });
  assert.equal(objectResult.invoiceType, "C0401");
  assert.equal(objectResult.invoiceStatus, 99);
  assert.equal(objectResult.printMark, "Y");
});

test("Amego invoice print requests original and reprint formats without exposing printer bytes", async () => {
  const posted: Array<Record<string, unknown>> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const form = new URLSearchParams(String(init?.body));
    posted.push(JSON.parse(form.get("data") ?? "{}") as Record<string, unknown>);
    return Response.json({ code: 0, data: { base64_data: "must-not-be-stored" } });
  };

  const original = await requestAmegoInvoicePrint({
    invoice: "12345678",
    appKey: "test-app-key",
    invoiceNumber: "AB12345678",
    printerType: 2,
    printerLang: 2,
    printInvoiceType: 1,
    fetcher
  });
  await requestAmegoInvoicePrint({
    invoice: "12345678",
    appKey: "test-app-key",
    invoiceNumber: "AB12345678",
    printerType: 2,
    printerLang: 2,
    printInvoiceType: 2,
    fetcher
  });

  assert.deepEqual(posted.map((item) => item.print_invoice_type), [1, 2]);
  assert.equal(posted[0].print_invoice_detail, 0);
  assert.equal(original.code, "0");
  assert.equal(JSON.stringify(sanitizeAmegoResponse(original.raw)).includes("must-not-be-stored"), false);
});

test("Amego response storage removes printer bytes and secrets recursively", () => {
  const sanitized = sanitizeAmegoResponse({
    code: 0,
    base64_data: "printer-bytes",
    sign: "signature",
    data: {
      invoice_number: "AB12345678",
      base64_data: "nested-printer-bytes",
      appKey: "secret"
    }
  });

  const serialized = JSON.stringify(sanitized);
  assert.equal(serialized.includes("printer-bytes"), false);
  assert.equal(serialized.includes("signature"), false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("AB12345678"), true);
});

function invoiceRequest(): AmegoInvoiceRequest {
  return {
    OrderId: "ORDER-001",
    BuyerIdentifier: "0000000000",
    BuyerName: "客人",
    BuyerAddress: "",
    BuyerTelephoneNumber: "",
    BuyerEmailAddress: "",
    MainRemark: "",
    CarrierType: "",
    CarrierId1: "",
    CarrierId2: "",
    NPOBAN: "",
    ProductItem: [{
      Description: "奶茶",
      Quantity: 1,
      UnitPrice: 45,
      Amount: 45,
      Remark: "",
      TaxType: "1"
    }],
    SalesAmount: "45",
    FreeTaxSalesAmount: "0",
    ZeroTaxSalesAmount: "0",
    TaxType: "1",
    TaxRate: "0.05",
    TaxAmount: "0",
    TotalAmount: "45"
  };
}
