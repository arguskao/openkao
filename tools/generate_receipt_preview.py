from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import code128
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm


PAGE_WIDTH = 58 * mm
PAGE_HEIGHT = 190 * mm
CONTENT_WIDTH = 50 * mm
CONTENT_LEFT = (PAGE_WIDTH - CONTENT_WIDTH) / 2
CONTENT_RIGHT = CONTENT_LEFT + CONTENT_WIDTH
MIN_MAJOR_FONT = 15
MIN_BODY_FONT = 6
FONT = "OpenKaoCJK"
FONT_PATH = "/System/Library/Fonts/STHeiti Medium.ttc"


def centered_text(pdf, y, text, size=8, font=FONT):
    pdf.setFont(font, size)
    pdf.drawCentredString(PAGE_WIDTH / 2, y, text)


def draw_qr(pdf, x, y, size, payload):
    widget = QrCodeWidget(payload)
    bounds = widget.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(widget)
    renderPDF.draw(drawing, pdf, x, y)


def _base_page(pdf, seller_name, invoice_number, has_buyer):
    y = PAGE_HEIGHT - 8 * mm
    centered_text(pdf, y, seller_name, 7)
    y -= 8 * mm
    centered_text(pdf, y, "電子發票證明聯", MIN_MAJOR_FONT)
    y -= 8 * mm
    centered_text(pdf, y, "115年07-08月", MIN_MAJOR_FONT)
    y -= 9 * mm
    centered_text(pdf, y, invoice_number, 18, "Helvetica-Bold")
    y -= 7 * mm
    if has_buyer:
        centered_text(pdf, y, "2026-07-12 15:30:00    格式:25", MIN_BODY_FONT)
    else:
        centered_text(pdf, y, "2026-07-12 15:30:00", MIN_BODY_FONT)
    y -= 5 * mm

    pdf.setFont(FONT, 7)
    pdf.drawString(CONTENT_LEFT, y, "隨機碼 1234")
    pdf.drawRightString(CONTENT_RIGHT, y, "總計 135")
    y -= 5 * mm
    pdf.drawString(CONTENT_LEFT, y, "賣方:12345678")
    if has_buyer:
        pdf.drawRightString(CONTENT_RIGHT, y, "買方:03741302")
    return y - 8 * mm


def _draw_barcodes(pdf, y):
    barcode_value = "11508AB123456781234"
    barcode = code128.Code128(barcode_value, barWidth=0.25 * mm, barHeight=16 * mm, quiet=True)
    barcode_y = y - 20 * mm
    barcode.drawOn(pdf, (PAGE_WIDTH - barcode.width) / 2, barcode_y)

    qr_size = 21 * mm
    qr_gap = 6 * mm
    qr_y = barcode_y - qr_size - 5 * mm
    pair_width = qr_size * 2 + qr_gap
    qr_x = (PAGE_WIDTH - pair_width) / 2
    draw_qr(
        pdf,
        qr_x,
        qr_y,
        qr_size,
        "AB123456781150712123400000087000000870000000012345678AMEGOLEFTPAYLOAD",
    )
    draw_qr(
        pdf,
        qr_x + qr_size + qr_gap,
        qr_y,
        qr_size,
        "**AMEGORIGHTPAYLOAD:2:2:1:加蛋:3:15:繁體中文奶茶:2:45",
    )
    return qr_y - 4 * mm


def _draw_items(pdf, y, has_buyer):
    pdf.setLineWidth(0.4)
    pdf.line(CONTENT_LEFT, y, CONTENT_RIGHT, y)
    y -= 5 * mm
    centered_text(pdf, y, "銷貨明細單", 8)
    y -= 6 * mm
    pdf.setFont(FONT, 7)
    pdf.drawString(CONTENT_LEFT, y, "嘉萱漢方有限公司")
    y -= 8 * mm
    pdf.setFont(FONT, 7)
    pdf.drawString(CONTENT_LEFT, y, "品名")
    pdf.drawString(27 * mm, y, "數量")
    pdf.drawString(36 * mm, y, "單價")
    pdf.drawRightString(CONTENT_RIGHT, y, "金額")
    y -= 6 * mm
    pdf.drawString(CONTENT_LEFT, y, "加蛋")
    pdf.drawString(29 * mm, y, "3")
    pdf.drawString(38 * mm, y, "15")
    pdf.drawRightString(CONTENT_RIGHT, y, "45")
    y -= 6 * mm
    pdf.drawString(CONTENT_LEFT, y, "繁體中文奶茶")
    pdf.drawString(29 * mm, y, "2")
    pdf.drawString(38 * mm, y, "45")
    pdf.drawRightString(CONTENT_RIGHT, y, "90")

    if has_buyer:
        y -= 10 * mm
        pdf.setFont(FONT, 9)
        pdf.drawString(CONTENT_LEFT, y, "銷售額(應稅)")
        pdf.drawRightString(CONTENT_RIGHT, y, "129")
        y -= 7 * mm
        pdf.drawString(CONTENT_LEFT, y, "稅額")
        pdf.drawRightString(CONTENT_RIGHT, y, "6")
        y -= 7 * mm
        pdf.drawString(CONTENT_LEFT, y, "總計")
        pdf.drawRightString(CONTENT_RIGHT, y, "135")
    else:
        y -= 8 * mm
        pdf.setLineWidth(0.4)
        pdf.line(CONTENT_LEFT, y, CONTENT_RIGHT, y)
        y -= 7 * mm
        pdf.setFont(FONT, 9)
        pdf.drawString(CONTENT_LEFT, y, "總計")
        pdf.drawRightString(CONTENT_RIGHT, y, "135")
        y -= 7 * mm
        pdf.drawString(CONTENT_LEFT, y, "課稅別")
        pdf.drawRightString(CONTENT_RIGHT, y, "TX")


def generate_invoice_preview(path, seller_name, invoice_number, has_buyer):
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(TTFont(FONT, FONT_PATH, subfontIndex=0))
    pdf = canvas.Canvas(str(output), pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
    y = _base_page(pdf, seller_name, invoice_number, has_buyer)
    y = _draw_barcodes(pdf, y)
    _draw_items(pdf, y, has_buyer)
    pdf.showPage()
    pdf.save()
    print(output)


def main():
    generate_invoice_preview(
        "output/pdf/openkao-58mm-invoice-preview.pdf",
        seller_name="嘉萱漢方有限公司",
        invoice_number="AB-12345678",
        has_buyer=True,
    )
    generate_invoice_preview(
        "output/pdf/openvokao_receipt_gbk_sample.pdf",
        seller_name="OpenvoKao 代刷",
        invoice_number="AB12345678",
        has_buyer=False,
    )


if __name__ == "__main__":
    main()
