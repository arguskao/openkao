#!/usr/bin/env python3
"""Query Amego's invoice_status API without changing invoice state."""

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


DEFAULT_ENDPOINT = "https://invoice-api.amego.tw/json/invoice_status"
SENSITIVE_RESPONSE_KEYS = {"appkey", "base64data", "sign"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="即時查詢光貿發票狀態（只讀，不會列印、補印或作廢）。"
    )
    parser.add_argument("invoice_number", help="發票號碼，例如 ZA10029651")
    parser.add_argument(
        "--invoice-account",
        default=os.getenv("AMEGO_INVOICE_ACCOUNT"),
        help="光貿 invoice 帳號；可改用 AMEGO_INVOICE_ACCOUNT 環境變數",
    )
    parser.add_argument(
        "--endpoint",
        default=DEFAULT_ENDPOINT,
        help=f"API endpoint（預設：{DEFAULT_ENDPOINT}）",
    )
    parser.add_argument("--timeout", type=float, default=15.0, help="逾時秒數（預設：15）")
    return parser.parse_args()


def sanitize(value: Any) -> Any:
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            normalized_key = key.replace("_", "").replace("-", "").lower()
            if normalized_key not in SENSITIVE_RESPONSE_KEYS:
                cleaned[key] = sanitize(item)
        return cleaned
    return value


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
    request_payload = [{"InvoiceNumber": invoice_number}]
    data = json.dumps(request_payload, ensure_ascii=False, separators=(",", ":"))
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
        args.endpoint,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    print(
        json.dumps(
            {
                "endpoint": args.endpoint,
                "invoiceAccount": invoice_account,
                "data": request_payload,
                "time": timestamp,
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    try:
        with urlopen(request, timeout=args.timeout) as response:
            status = response.status
            response_text = response.read().decode("utf-8")
    except HTTPError as error:
        status = error.code
        response_text = error.read().decode("utf-8", errors="replace")
    except URLError as error:
        print(f"連線失敗：{error.reason}", file=sys.stderr)
        return 1

    try:
        response_json = json.loads(response_text)
    except json.JSONDecodeError:
        print(f"HTTP {status}\n非 JSON 回應：{response_text}", file=sys.stderr)
        return 1

    print(f"HTTP {status}")
    print(json.dumps(sanitize(response_json), ensure_ascii=False, indent=2))
    return 0 if 200 <= status < 300 else 1


if __name__ == "__main__":
    raise SystemExit(main())
