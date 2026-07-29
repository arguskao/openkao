import Foundation

enum CheckoutDiscountType: String, Codable, CaseIterable, Identifiable {
    case amount
    case percentage

    var id: String { rawValue }

    var title: String {
        switch self {
        case .amount: return "折抵金額"
        case .percentage: return "打折"
        }
    }
}

struct CheckoutDiscount: Codable, Equatable {
    var type: CheckoutDiscountType
    var value: Int

    var description: String {
        switch type {
        case .amount: return "折抵 \(value) 元"
        case .percentage: return "打 \(value) 折"
        }
    }
}

struct CheckoutLine: Identifiable, Equatable {
    let id: Int
    let name: String
    let quantity: Int
    let unitPrice: Int

    var amount: Int { quantity * unitPrice }
}

struct CheckoutSummary: Equatable {
    let subtotal: Int
    let discount: CheckoutDiscount?
    let discountAmount: Int
    let total: Int
    let receivedAmount: Int?

    var changeAmount: Int? {
        receivedAmount.map { $0 - total }
    }

    var shortageAmount: Int? {
        guard let changeAmount, changeAmount < 0 else { return nil }
        return -changeAmount
    }
}

enum CheckoutCalculator {
    static func summary(
        subtotal: Int,
        discount: CheckoutDiscount?,
        receivedAmount: Int?,
        defaultToExactPayment: Bool = false
    ) -> CheckoutSummary? {
        guard subtotal > 0 else { return nil }
        guard let discountAmount = discountAmount(subtotal: subtotal, discount: discount) else { return nil }
        let total = subtotal - discountAmount
        guard total > 0 else { return nil }
        return CheckoutSummary(
            subtotal: subtotal,
            discount: discount,
            discountAmount: discountAmount,
            total: total,
            receivedAmount: receivedAmount ?? (defaultToExactPayment ? total : nil)
        )
    }

    static func discountAmount(subtotal: Int, discount: CheckoutDiscount?) -> Int? {
        guard subtotal > 0 else { return nil }
        guard let discount else { return 0 }

        switch discount.type {
        case .amount:
            guard (0...subtotal).contains(discount.value) else { return nil }
            return discount.value
        case .percentage:
            guard (1...100).contains(discount.value) else { return nil }
            let discountedTotal = Int((Int64(subtotal) * Int64(discount.value) + 50) / 100)
            return subtotal - discountedTotal
        }
    }

    // The discount is its own invoice line so product prices always remain the agreed original prices.
    static func invoiceLines(from lines: [CheckoutLine], discountAmount: Int) -> [CheckoutLine]? {
        let subtotal = lines.reduce(0) { $0 + $1.amount }
        guard subtotal > 0, discountAmount >= 0, discountAmount < subtotal else { return nil }
        guard discountAmount > 0 else { return lines }
        var result = lines
        let nextID = (lines.map(\.id).max() ?? 0) + 1
        result.append(CheckoutLine(id: nextID, name: "整單折扣", quantity: 1, unitPrice: -discountAmount))
        return result
    }
}
