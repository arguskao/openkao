export type FieldError = {
  field: string;
  code: string;
  message?: string;
};

export class HttpError extends Error {
  readonly code: string;
  readonly fieldErrors: FieldError[];

  constructor(
    readonly status: number,
    message: string,
    options?: {
      code?: string;
      fieldErrors?: FieldError[];
    }
  ) {
    super(message);
    this.code = options?.code ?? message;
    this.fieldErrors = options?.fieldErrors ?? [];
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

export function buildErrorResponse(error: unknown, requestId: string) {
  if (error instanceof HttpError) {
    const message = localizedMessageForCode(error.code);
    return {
      error: error.message,
      code: error.code,
      message,
      fieldErrors: inferFieldErrors(error.code, error.fieldErrors),
      requestId
    };
  }

  const message = error instanceof Error ? error.message : "unknown_error";
  return {
    error: message,
    code: message,
    message,
    fieldErrors: [],
    requestId
  };
}

export function buildInternalErrorResponse(requestId: string) {
  return {
    error: "internal_error",
    code: "internal_error",
    message: localizedMessageForCode("internal_error"),
    fieldErrors: [],
    requestId
  };
}

function inferFieldErrors(code: string, existing: FieldError[]): Array<FieldError & { message: string }> {
  if (existing.length > 0) {
    return existing.map((fieldError) => ({
      ...fieldError,
      message: fieldError.message ?? localizedMessageForCode(code)
    }));
  }

  const match = code.match(/^(.+)_(required|invalid|too_long|too_many)$/);
  if (!match) {
    return [];
  }

  return [{
    field: match[1],
    code: match[2],
    message: localizedMessageForCode(code)
  }];
}

function localizedMessageForCode(code: string): string {
  const messages: Record<string, string> = {
    account_already_registered: "這個帳號已經註冊。",
    account_invalid: "帳號只能使用英文字母、數字、底線或減號。",
    amego_app_key_not_configured: "尚未設定光貿 App Key。",
    amego_invoice_rejected: "光貿拒絕開立發票，請檢查發票資料。",
    amego_payload_incomplete: "光貿已回應，但缺少正式條碼或 QRCode 資料。",
    amego_result_unknown: "光貿開票結果尚未確認，系統不會重複開票，請稍後再試。",
    admin_token_not_configured: "後台 Token 尚未設定。",
    company_tax_id_exists: "這個統一編號已經註冊。",
    content_length_invalid: "請求大小格式不正確。",
    content_type_invalid: "請使用 JSON 格式送出資料。",
    date_range_invalid: "日期區間不正確。",
    date_range_too_large: "日期區間太大。",
    device_binding_locked: "這個帳號已綁定第一台手機，換手機前需要解除綁定。",
    device_not_bound: "這台裝置尚未綁定。",
    forbidden: "權限不足。",
    internal_error: "伺服器暫時無法處理，請提供 request ID 協助查詢。",
    invalid_admin_token: "後台 Token 不正確。",
    invalid_auth_token: "登入已失效，請重新登入。",
    invalid_credentials: "帳號或密碼不正確。",
    invalid_device_id: "裝置資料不正確。",
    invalid_device_token: "裝置 Token 不正確。",
    invalid_json: "JSON 格式不正確。",
    invoice_destination_conflict: "統編、載具與捐贈碼不能同時使用。",
    invoice_idempotency_conflict: "這個訂單編號已用於不同的發票內容。",
    invoice_issuance_failed: "這筆訂單先前開票失敗，請更正資料後使用新的訂單編號。",
    items_too_many: "品項筆數太多。",
    json_object_required: "請求內容必須是 JSON 物件。",
    missing_auth_token: "缺少登入 Token。",
    missing_device_token: "缺少裝置 Token。",
    not_found: "找不到資料。",
    owner_required: "此操作需要老闆權限。",
    password_too_short: "密碼長度不足。",
    price_decimal_places_precision_loss: "目前商品價格含有更細的小數，不能直接降低小數位數。",
    request_body_too_large: "請求內容太大。",
    total_amount_mismatch: "總金額必須等於所有品項小計加總。"
  };

  if (messages[code]) {
    return messages[code];
  }

  if (code.endsWith("_required")) {
    return "這個欄位必填。";
  }
  if (code.endsWith("_invalid")) {
    return "這個欄位格式不正確。";
  }
  if (code.endsWith("_too_long")) {
    return "這個欄位太長。";
  }
  if (code.endsWith("_too_many")) {
    return "資料筆數太多。";
  }

  return code;
}
