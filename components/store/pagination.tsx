"use client"

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PaginationProps {
    currentPage: number
    totalPages: number
    onPageChange: (page: number) => void
    isLoading?: boolean
}

export function Pagination({
    currentPage,
    totalPages,
    onPageChange,
    isLoading = false,
}: PaginationProps) {
    if (totalPages <= 1) return null

    // Helper to generate page range
    const getPageRange = () => {
        const delta = 1 // number of pages to show before and after current page
        const range = []

        for (
            let i = Math.max(2, currentPage - delta);
            i <= Math.min(totalPages - 1, currentPage + delta);
            i++
        ) {
            range.push(i)
        }

        if (currentPage - delta > 2) {
            range.unshift("...")
        }
        if (currentPage + delta < totalPages - 1) {
            range.push("...")
        }

        range.unshift(1)
        if (totalPages > 1) {
            range.push(totalPages)
        }

        return range
    }

    const pages = getPageRange()

    return (
        <div className="flex flex-col items-center gap-4 py-10">
            <div className="flex items-center gap-1 sm:gap-2">
                {/* First Page */}
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onPageChange(1)}
                    disabled={currentPage === 1 || isLoading}
                    className="hidden sm:flex h-9 w-9 rounded-full border-primary/20 hover:bg-primary hover:text-primary-foreground transition-all"
                    title="Primeira página"
                >
                    <ChevronsLeft className="h-4 w-4" />
                </Button>

                {/* Previous Page */}
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1 || isLoading}
                    className="h-9 w-9 rounded-full border-primary/20 hover:bg-primary hover:text-primary-foreground transition-all"
                    title="Anterior"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>

                {/* Page Numbers */}
                <div className="flex items-center gap-1">
                    {pages.map((page, index) => (
                        <React.Fragment key={index}>
                            {page === "..." ? (
                                <span className="w-8 text-center text-muted-foreground">...</span>
                            ) : (
                                <Button
                                    variant={currentPage === page ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => onPageChange(page as number)}
                                    disabled={isLoading}
                                    className={cn(
                                        "h-9 w-9 rounded-full transition-all font-bold",
                                        currentPage === page
                                            ? "bg-primary text-primary-foreground shadow-md scale-110"
                                            : "border-primary/20 hover:border-primary/50 text-muted-foreground hover:text-primary"
                                    )}
                                >
                                    {page}
                                </Button>
                            )}
                        </React.Fragment>
                    ))}
                </div>

                {/* Next Page */}
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage === totalPages || isLoading}
                    className="h-9 w-9 rounded-full border-primary/20 hover:bg-primary hover:text-primary-foreground transition-all"
                    title="Próxima"
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>

                {/* Last Page */}
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onPageChange(totalPages)}
                    disabled={currentPage === totalPages || isLoading}
                    className="hidden sm:flex h-9 w-9 rounded-full border-primary/20 hover:bg-primary hover:text-primary-foreground transition-all"
                    title="Última página"
                >
                    <ChevronsRight className="h-4 w-4" />
                </Button>
            </div>

            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
                Página {currentPage} de {totalPages}
            </p>
        </div>
    )
}

// Add React import since I'm using Fragment
import React from "react"
