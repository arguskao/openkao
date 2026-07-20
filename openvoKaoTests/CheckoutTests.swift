import XCTest
@testable import openvoKao

final class CheckoutTests: XCTestCase {
    func testChangeCalculatesFromReceivedAmount() throws {
        let summary = try XCTUnwrap(CheckoutCalculator.summary(subtotal: 45, discount: nil, receivedAmount: 100))

        XCTAssertEqual(summary.total, 45)
        XCTAssertEqual(summary.changeAmount, 55)

        let thousand = try XCTUnwrap(CheckoutCalculator.summary(subtotal: 45, discount: nil, receivedAmount: 1_000))
        XCTAssertEqual(thousand.changeAmount, 955)
    }

    func testPercentageDiscountRoundsToWholeDollar() throws {
        let discount = CheckoutDiscount(type: .percentage, value: 85)
        let summary = try XCTUnwrap(CheckoutCalculator.summary(subtotal: 99, discount: discount, receivedAmount: 100))

        XCTAssertEqual(summary.discountAmount, 15)
        XCTAssertEqual(summary.total, 84)
        XCTAssertEqual(summary.changeAmount, 16)
    }

    func testDiscountIsASeparateWholeOrderInvoiceLine() throws {
        let lines = [
            CheckoutLine(id: 1, name: "清掃服務", quantity: 2, unitPrice: 45),
            CheckoutLine(id: 2, name: "用品", quantity: 1, unitPrice: 10)
        ]
        let invoiceLines = try XCTUnwrap(CheckoutCalculator.invoiceLines(from: lines, discountAmount: 15))

        XCTAssertEqual(invoiceLines.reduce(0) { $0 + $1.amount }, 85)
        XCTAssertEqual(invoiceLines.map(\.name), ["清掃服務", "用品", "整單折扣"])
        XCTAssertEqual(invoiceLines[0].unitPrice, 45)
        XCTAssertEqual(invoiceLines[1].unitPrice, 10)
        XCTAssertEqual(invoiceLines[2].unitPrice, -15)
    }

    func testReceivedAmountBelowTotalHasShortage() throws {
        let summary = try XCTUnwrap(CheckoutCalculator.summary(subtotal: 45, discount: nil, receivedAmount: 40))

        XCTAssertEqual(summary.shortageAmount, 5)
    }
}
