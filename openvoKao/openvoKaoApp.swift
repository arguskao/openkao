//
//  openvoKaoApp.swift
//  openvoKao
//
//  Created by user on 2026/7/9.
//

import SwiftUI

@main
struct openvoKaoApp: App {
    @StateObject private var store = AppStore()
    @StateObject private var printerManager = PrinterManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .environmentObject(printerManager)
        }
    }
}
