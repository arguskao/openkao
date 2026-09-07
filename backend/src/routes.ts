export function allowedMethodsForPath(pathname: string): string[] {
  if (pathname === "/api/health") return ["GET"];
  if (pathname === "/api/auth/register") return ["POST"];
  if (pathname === "/api/auth/login") return ["POST"];
  if (pathname === "/api/auth/me") return ["GET"];
  if (pathname === "/api/auth/logout") return ["POST"];
  if (pathname === "/api/account") return ["DELETE"];
  if (pathname === "/api/members") return ["GET", "POST"];
  if (/^\/api\/members\/[^/]+$/.test(pathname)) return ["PUT", "DELETE"];
  if (/^\/api\/members\/[^/]+\/reset-password$/.test(pathname)) return ["POST"];
  if (pathname === "/api/reports/sales") return ["GET"];
  if (pathname === "/api/invoices") return ["GET", "POST"];
  if (/^\/api\/invoices\/[^/]+$/.test(pathname)) return ["GET"];
  if (/^\/api\/invoices\/[^/]+\/refresh$/.test(pathname)) return ["POST"];
  if (/^\/api\/invoices\/[^/]+\/reprint$/.test(pathname)) return ["POST"];
  if (/^\/api\/invoices\/[^/]+\/void$/.test(pathname)) return ["POST"];
  if (pathname === "/api/devices/register") return ["POST"];
  if (pathname === "/api/devices/me") return ["GET"];
  if (pathname === "/api/devices") return ["GET", "POST"];
  if (pathname === "/api/devices/audit-logs") return ["GET"];
  if (/^\/api\/devices\/[^/]+$/.test(pathname)) return ["PUT", "DELETE"];
  if (/^\/api\/devices\/[^/]+\/rotate-token$/.test(pathname)) return ["POST"];
  if (pathname === "/api/print-jobs/pending") return ["GET"];
  if (/^\/api\/print-jobs\/[^/]+$/.test(pathname)) return ["GET"];
  if (/^\/api\/print-jobs\/[^/]+\/printed$/.test(pathname)) return ["POST"];
  if (/^\/api\/print-jobs\/[^/]+\/failed$/.test(pathname)) return ["POST"];
  if (pathname === "/api/catalog/categories") return ["GET", "POST"];
  if (/^\/api\/catalog\/categories\/[^/]+$/.test(pathname)) return ["PUT", "DELETE"];
  if (pathname === "/api/catalog/products") return ["GET", "POST"];
  if (pathname === "/api/catalog/settings") return ["PUT"];
  if (/^\/api\/catalog\/products\/[^/]+$/.test(pathname)) return ["PUT", "DELETE"];
  if (pathname === "/api/admin/summary") return ["GET"];
  if (pathname === "/api/admin/companies") return ["POST"];
  if (/^\/api\/admin\/companies\/[^/]+\/device-limit$/.test(pathname)) return ["PATCH"];
  if (pathname === "/api/admin/products") return ["GET", "POST"];
  if (pathname === "/api/admin/users") return ["GET"];
  if (/^\/api\/admin\/users\/[^/]+\/reset-password$/.test(pathname)) return ["POST"];
  if (pathname === "/api/admin/print-jobs") return ["GET", "POST"];
  if (/^\/api\/admin\/print-jobs\/[^/]+\/release$/.test(pathname)) return ["POST"];
  return [];
}

export function routeName(pathname: string): string {
  if (pathname === "/") return "GET /";
  const methods = allowedMethodsForPath(pathname);
  if (methods.length > 0) {
    return `${methods.join("|")} ${pathname.replace(/\/(?:[0-9a-fA-F-]{16,}|[0-9]+)/g, "/:id")}`;
  }
  if (/^\/api\/devices\/[^/]+$/.test(pathname)) return "PUT|DELETE /api/devices/:id";
  if (/^\/api\/members\/[^/]+$/.test(pathname)) return "PUT|DELETE /api/members/:id";
  if (/^\/api\/members\/[^/]+\/reset-password$/.test(pathname)) return "POST /api/members/:id/reset-password";
  if (/^\/api\/admin\/companies\/[^/]+\/device-limit$/.test(pathname)) return "PATCH /api/admin/companies/:id/device-limit";
  if (/^\/api\/devices\/[^/]+\/rotate-token$/.test(pathname)) return "POST /api/devices/:id/rotate-token";
  if (/^\/api\/print-jobs\/[^/]+$/.test(pathname)) return "GET /api/print-jobs/:id";
  if (/^\/api\/print-jobs\/[^/]+\/printed$/.test(pathname)) return "POST /api/print-jobs/:id/printed";
  if (/^\/api\/print-jobs\/[^/]+\/failed$/.test(pathname)) return "POST /api/print-jobs/:id/failed";
  if (/^\/api\/invoices\/[^/]+$/.test(pathname)) return "GET /api/invoices/:id";
  if (/^\/api\/invoices\/[^/]+\/refresh$/.test(pathname)) return "POST /api/invoices/:id/refresh";
  if (/^\/api\/invoices\/[^/]+\/reprint$/.test(pathname)) return "POST /api/invoices/:id/reprint";
  if (/^\/api\/invoices\/[^/]+\/void$/.test(pathname)) return "POST /api/invoices/:id/void";
  if (/^\/api\/catalog\/categories\/[^/]+$/.test(pathname)) return "PUT|DELETE /api/catalog/categories/:id";
  if (/^\/api\/catalog\/products\/[^/]+$/.test(pathname)) return "PUT|DELETE /api/catalog/products/:id";
  if (/^\/api\/admin\/users\/[^/]+\/reset-password$/.test(pathname)) return "POST /api/admin/users/:id/reset-password";
  if (/^\/api\/admin\/print-jobs\/[^/]+\/release$/.test(pathname)) return "POST /api/admin/print-jobs/:id/release";
  return "unknown";
}
