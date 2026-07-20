export type PrintJobPayload = {
  remoteId: string;
  invoiceNumber: string;
  randomNumber: string;
  issuedAt: string;
  sellerName?: string;
  sellerIdentifier?: string;
  buyerIdentifier?: string;
  totalAmount: number;
  salesAmount?: number;
  taxAmount?: number;
  subtotalAmount?: number;
  discountType?: "amount" | "percentage";
  discountValue?: number;
  discountAmount?: number;
  receivedAmount?: number;
  changeAmount?: number;
  invoiceFormatCode?: string;
  isReprint?: boolean;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  qrCodePayload?: string;
  leftQRCodePayload?: string;
  rightQRCodePayload?: string;
  barcodePayload?: string;
};

export type DeviceSession = {
  id: string;
  company_id: number;
  name: string;
};

export type DeviceIdentity = {
  id: string;
  name: string;
  token?: string;
};

export type PrintJobRow = {
  id: string;
  payload_json: string;
  status: string;
  created_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempt_count: number | null;
};

export type ManagedDeviceRow = {
  id: string;
  company_id: number;
  name: string;
  platform: string;
  installation_id: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AuditLogRow = {
  id: string;
  company_id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  actor_account: string | null;
  actor_device_id: string | null;
  target_type: string;
  target_id: string;
  action: string;
  details_json: string | null;
  created_at: string;
};

export type AdminUserRow = {
  id: number;
  account: string;
  name: string | null;
  phone: string | null;
  company_id: number | null;
  company_name: string | null;
  role: string | null;
  is_active: number;
  created_at: string;
};

export type UserSession = {
  token: string;
  token_hash: string | null;
  user_id: number;
  company_id: number;
  device_id: string | null;
  role: string;
  is_active: number;
  name: string | null;
  account: string;
  phone: string | null;
  company_name: string;
  tax_id: string;
  address: string | null;
  amego_app_key: string | null;
};

export type SalesInvoiceRow = {
  invoice_id: string;
  invoice_number: string;
  random_number: string;
  issued_at: string;
  seller_name: string | null;
  seller_identifier: string | null;
  buyer_identifier: string | null;
  total_amount: number;
  print_status: string | null;
  item_id: string | null;
  item_name: string | null;
  item_quantity: number | null;
  item_unit_price: number | null;
  item_amount: number | null;
};

export type SalesSummaryRow = {
  name: string;
  quantity: number | null;
  total: number | null;
};

export type SalesInvoiceHeaderRow = {
  invoice_id: string;
  invoice_number: string;
  random_number: string;
  issued_at: string;
  seller_name: string | null;
  seller_identifier: string | null;
  buyer_identifier: string | null;
  total_amount: number;
  print_status: string | null;
};

export type CatalogCategoryRow = {
  id: number;
  name: string;
  sort_order: number;
  status: string | null;
  product_count?: number | null;
};

export type CatalogProductRow = {
  id: number;
  category_id: number | null;
  category_name: string | null;
  name: string;
  price: number;
  decimal_places: number | null;
  image_path: string | null;
  is_active: number;
  tax_type: string | null;
  sort_order: number | null;
};
