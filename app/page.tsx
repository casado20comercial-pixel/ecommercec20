"use client"

import { useState } from "react"
import { Header } from "@/components/store/header"
import { BottomNav } from "@/components/store/bottom-nav"
import { ProductGrid } from "@/components/store/product-grid"
import { CategorySidebar } from "@/components/store/category-sidebar"
import { HeroBanner } from "@/components/store/hero-banner"
import { MobileCategorySheet } from "@/components/store/mobile-category-sheet"
import { LayoutGrid } from "lucide-react"

export default function StorePage() {
  const [activeTab, setActiveTab] = useState("home")
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false)

  const handleViewOffers = () => {
    setSelectedCategory(null)
    setActiveTab("home")
    window.scrollTo({ top: 300, behavior: "smooth" })
  }

  const handleCategoryChange = (categoryId: string | null) => {
    setSelectedCategory(categoryId)
    setActiveTab("home")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleTabChange = (tab: string) => {
    if (tab === "categories") {
      setIsCategorySheetOpen(true)
      setActiveTab("categories")
    } else if (tab === "home") {
      setSelectedCategory(null)
      setActiveTab("home")
      window.scrollTo({ top: 0, behavior: "smooth" })
    } else {
      setActiveTab(tab)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main className="container mx-auto px-4 py-4 pb-20">
        <div className="flex gap-6">
          <CategorySidebar
            selectedCategory={selectedCategory}
            onSelectCategory={handleCategoryChange}
          />

          <div className="flex-1 min-w-0">
            {activeTab === "home" && !selectedCategory && (
              <HeroBanner onViewOffers={handleViewOffers} />
            )}

            <ProductGrid
              selectedCategory={selectedCategory}
              onCategoryChange={handleCategoryChange}
            />
          </div>
        </div>
      </main>

      {/* Floating Action Button (FAB) - Mobile Only */}
      <button
        type="button"
        onClick={() => setIsCategorySheetOpen(true)}
        className="md:hidden fixed bottom-24 right-6 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] border-2 border-background flex items-center justify-center z-40 active:scale-90 transition-all hover:bg-primary/90 group"
        aria-label="Ver Categorias"
      >
        <LayoutGrid className="w-6 h-6 group-hover:rotate-12 transition-transform" />
        <span className="absolute -top-1 -right-1 flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
          <span className="relative inline-flex rounded-full h-4 w-4 bg-secondary"></span>
        </span>
      </button>

      <div className="h-16 md:hidden" />

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />

      <MobileCategorySheet
        open={isCategorySheetOpen}
        onOpenChange={setIsCategorySheetOpen}
        selectedCategory={selectedCategory}
        onSelectCategory={handleCategoryChange}
      />

    </div>
  )
}
