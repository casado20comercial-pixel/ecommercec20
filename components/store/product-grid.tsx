"use client"

import React, { useEffect } from "react"
import { Product, Category } from "@/lib/types"
import { ProductCard, ProductCardSkeleton } from "./product-card"
import { useSearchStore, useProductStore } from "@/lib/store"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { Home, Sparkles, Utensils, Archive, ToyBrick, SearchX, PiggyBank, Banknote, Package, Droplets, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  "toy-brick": ToyBrick,
  sparkles: Sparkles,
  home: Home,
  utensils: Utensils,
  archive: Archive,
  "piggy-bank": PiggyBank,
  banknote: Banknote,
  package: Package,
  droplets: Droplets,
}

import { Pagination } from "./pagination"

interface ProductGridProps {
  selectedCategory: string | null
  onCategoryChange: (categoryId: string | null) => void
}

export function ProductGrid({ selectedCategory, onCategoryChange }: ProductGridProps) {
  const { query, setQuery } = useSearchStore()
  const {
    products,
    categories,
    isLoading,
    totalCount,
    page,
    limit,
    fetchProducts
  } = useProductStore()
  const { toast } = useToast()

  // Initial fetch
  useEffect(() => {
    fetchProducts(true, selectedCategory, query)
  }, [])

  // Sync with filters + DEBOUNCE
  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchProducts(true, selectedCategory, query)
    }, 400)

    return () => clearTimeout(timeout)
  }, [selectedCategory, query, fetchProducts])

  const handleAddToCart = (productName: string) => {
    toast({
      title: "Adicionado ao carrinho!",
      description: `${productName} foi adicionado.`,
      duration: 2000,
    })
  }

  const handlePageChange = (targetPage: number) => {
    fetchProducts(false, selectedCategory, query, targetPage)
  }

  let title = "Todos os Produtos"

  if (query) {
    title = `Resultados para "${query}"`
  } else if (selectedCategory) {
    const category = categories.find((c: Category) => c.id === selectedCategory)
    title = category?.name || "Produtos"
  }

  const showSkeleton = isLoading && products.length === 0
  const totalPages = Math.ceil(totalCount / limit)

  return (
    <div className="flex-1">

      {/* Title */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-foreground">{title}</h2>
        </div>
        {!showSkeleton && totalPages > 1 && (
          <span className="text-[10px] font-bold text-muted-foreground uppercase bg-muted/50 px-2 py-1 rounded">
            Página {page} de {totalPages}
          </span>
        )}
      </div>

      {/* Grid */}
      {showSkeleton ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: limit / 2 }).map((_, i) => (
            <div key={i} className="p-4">
              <ProductCardSkeleton />
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center animate-in fade-in zoom-in duration-300">
          <div className="bg-muted rounded-full p-6 mb-4">
            <SearchX className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">Nenhum produto encontrado</h3>
          <p className="text-muted-foreground max-w-md mb-6">
            Não encontramos resultados para <span className="font-medium text-foreground">"{query}"</span>.
          </p>
          <Button
            onClick={() => {
              setQuery('')
              onCategoryChange(null)
            }}
            variant="secondary"
            className="font-semibold"
          >
            Ver Tudo
          </Button>
        </div>
      ) : (
        <div className={cn("transition-opacity duration-300", isLoading ? "opacity-40" : "opacity-100")}>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {products.map((product: Product) => (
              <div key={product.id} className="p-4 transition-shadow hover:shadow-[0_0_20px_rgba(0,0,0,0.05)] rounded-sm">
                <ProductCard
                  product={product}
                  onAddToCart={() => handleAddToCart(product.name)}
                />
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 border-t pt-2">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                isLoading={isLoading}
              />
            </div>
          )}

          <div className="py-8 text-center">
            <p className="text-muted-foreground text-xs italic opacity-40">
              CUIDADOSAMENTE SELECIONADO PARA VOCÊ ✨
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
