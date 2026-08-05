#!/usr/bin/env python3
"""Test whether Amego allows invoice_print type 2 for an invoice.

This call is not read-only: Amego may record a print/reprint action. Printer
bytes returned as base64_data are never printed or saved by this script.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_API_BASE_URL = "https://invoice-api.amego.tw/json"
SENSITIVE_RESPONSE_KEYS = {"appkey", "base64data", "sign"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "先查 invoice_status 與 invoice_query，再選擇是否呼叫 invoice_print type 2。"
        )
    )
    parser.add_argument("invoice_number", help="發票號碼，例如 ZA10029651")
    parser.add_argument(
        "--invoice-account",
        default=os.getenv("AMEGO_INVOICE_ACCOUNT"),
        help="光貿 invoice 帳號；可改用 AMEGO_INVOICE_ACCOUNT 環境變數",
    )
    parser.add_argument("--printer-type", type=int, default=2, help="預設：2")
    parser.add_argument("--printer-lang", type=int, default=2, help="預設：2")
    parser.add_argument(
        "--api-base-url",
        default=DEFAULT_API_BASE_URL,
        help=f"預設：{DEFAULT_API_BASE_URL}",
    )
    parser.add_argument("--timeout", type=float, default=15.0, help="逾時秒數（預設：15）")
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="只查 invoice_status 與 invoice_query，不呼叫 invoice_print",
    )
    parser.add_argument("--yes", action="store_true", help="略過執行前確認")
    return parser.parse_args()


def normalized_key(key: str) -> str:
    return key.replace("_", "").replace("-", "").lower()


def sanitize(value: Any) -> Any:
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            if normalized_key(key) not in SENSITIVE_RESPONSE_KEYS:
                cleaned[key] = sanitize(item)
        return cleaned
    return value


def find_base64_data(value: Any) -> tuple[bool, int]:
    if isinstance(value, list):
        results = [find_base64_data(item) for item in value]
        return any(found for found, _ in results), sum(length for _, length in results)
    if isinstance(value, dict):
        found = False
        total_length = 0
        for key, item in value.items():
            if normalized_key(key) == "base64data":
                found = True
                total_length += len(item) if isinstance(item, str) else 0
            else:
                nested_found, nested_length = find_base64_data(item)
                found = found or nested_found
                total_length += nested_length
        return found, total_length
    return False, 0


def call_amego(
    *,
    endpoint: str,
    invoice_account: str,
    app_key: str,
    payload: Any,
    timeout: float,
) -> tuple[int, Any]:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    timestamp = str(int(time.time()))
    signature = hashlib.md5(
        f"{data}{timestamp}{app_key}".encode("utf-8"), usedforsecurity=False
    ).hexdigest()
    body = urlencode(
        {
            "invoice": invoice_account,
            "data": data,
            "time": timestamp,
            "sign": signature,
        }
    ).encode("utf-8")
    request = Request(
        endpoint,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            status = response.status
            response_text = response.read().decode("utf-8")
    except HTTPError as error:
        status = error.code
        response_text = error.read().decode("utf-8", errors="replace")
    except URLError as error:
        raise RuntimeError(f"連線失敗：{error.reason}") from error

    try:
        return status, json.loads(response_text)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"HTTP {status}，收到非 JSON 回應：{response_text}") from error


def print_result(label: str, http_status: int, response_json: Any) -> None:
    base64_present, base64_length = find_base64_data(response_json)
    print(f"\n=== {label} ===")
    print(f"HTTP {http_status}")
    print(json.dumps(sanitize(response_json), ensure_ascii=False, indent=2))
    if label == "invoice_print type 2":
        print(
            json.dumps(
                {
                    "base64DataReturned": base64_present,
                    "base64DataLength": base64_length,
                    "base64DataDiscarded": True,
                },
                ensure_ascii=False,
                indent=2,
            )
        )


def main() -> int:
    args = parse_args()
    invoice_account = (args.invoice_account or "").strip()
    if not invoice_account:
        print("錯誤：請提供 --invoice-account 或 AMEGO_INVOICE_ACCOUNT。", file=sys.stderr)
        return 2

    app_key = os.getenv("AMEGO_APP_KEY", "").strip()
    if not app_key:
        app_key = getpass.getpass("光貿 App Key（輸入不會顯示）: ").strip()
    if not app_key:
        print("錯誤：App Key 不可為空。", file=sys.stderr)
        return 2

    invoice_number = args.invoice_number.strip().upper()
    api_base_url = args.api_base_url.rstrip("/")
    status_payload = [{"InvoiceNumber": invoice_number}]
    query_payload = {"type": "invoice", "invoice_number": invoice_number}
    print_payload = {
        "type": "invoice",
        "invoice_number": invoice_number,
        "printer_type": args.printer_type,
        "printer_lang": args.printer_lang,
        "print_invoice_type": 2,
        "print_invoice_detail": 0,
    }

    print(
        json.dumps(
            {
                "invoiceNumber": invoice_number,
                "invoiceAccount": invoice_account,
                "invoicePrintRequest": print_payload,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    try:
        before_status, before_json = call_amego(
            endpoint=f"{api_base_url}/invoice_status",
            invoice_account=invoice_account,
            app_key=app_key,
            payload=status_payload,
            timeout=args.timeout,
        )
        print_result("執行前 invoice_status", before_status, before_json)

        before_query_status, before_query_json = call_amego(
            endpoint=f"{api_base_url}/invoice_query",
            invoice_account=invoice_account,
            app_key=app_key,
            payload=query_payload,
            timeout=args.timeout,
        )
        print_result("執行前 invoice_query", before_query_status, before_query_json)

        if args.check_only:
            print("\ncheck-only 完成，未呼叫 invoice_print。")
            return 0

        if not args.yes:
            answer = input(
                "注意：invoice_print 可能在光貿留下補印／列印註記。確定執行？[y/N] "
            )
            if answer.strip().lower() not in {"y", "yes"}:
                print("已取消，未呼叫 invoice_print。")
                return 0

        print_status, print_json = call_amego(
            endpoint=f"{api_base_url}/invoice_print",
            invoice_account=invoice_account,
            app_key=app_key,
            payload=print_payload,
            timeout=args.timeout,
        )
        print_result("invoice_print type 2", print_status, print_json)

        after_status, after_json = call_amego(
            endpoint=f"{api_base_url}/invoice_status",
            invoice_account=invoice_account,
            app_key=app_key,
            payload=status_payload,
            timeout=args.timeout,
        )
        print_result("執行後 invoice_status", after_status, after_json)

        after_query_status, after_query_json = call_amego(
            endpoint=f"{api_base_url}/invoice_query",
            invoice_account=invoice_account,
            app_key=app_key,
            payload=query_payload,
            timeout=args.timeout,
        )
        print_result("執行後 invoice_query", after_query_status, after_query_json)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
