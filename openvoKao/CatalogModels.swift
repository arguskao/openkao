import Foundation

struct CatalogCategory: Identifiable, Codable, Equatable {
    var id: Int
    var name: String
    var sortOrder: Int
    var status: String
    var productCount: Int
}

struct CatalogProduct: Identifiable, Codable, Equatable {
    var id: Int
    var categoryId: Int?
    var categoryName: String?
    var name: String
    var price: Int
    var imagePath: String?
    var status: String
    var taxType: String
    var sortOrder: Int
}
