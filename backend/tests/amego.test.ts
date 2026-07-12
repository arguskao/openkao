import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  AmegoTransportError,
  createAmegoSignature,
  issueAmegoInvoice,
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
