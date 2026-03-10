import type { Product } from './types'

export const categories = [
  { id: 'toys', name: 'Brinquedos', icon: 'toy-brick' },
  { id: 'hygiene', name: 'Higiene', icon: 'sparkles' },
  { id: 'kitchen', name: 'Cozinha', icon: 'utensils' },
  { id: 'organization', name: 'Organização', icon: 'archive' },
  { id: 'Geral', name: 'Geral', icon: 'package' },
  { id: 'cleaning', name: 'Limpeza', icon: 'droplets' },
  { id: 'price-under-25', name: 'Até R$ 25', icon: 'piggy-bank' },
  { id: 'price-over-25', name: 'Acima de R$ 25', icon: 'banknote' },
]

export const products: Product[] = [
  {
    id: 'kiv001',
    ref: 'KIV001',
    name: 'Kit Viagem Baby 10 Pçs',
    price: 15.00,
    ipi: 6.5,
    masterBox: 96,
    subBox: 24,
    material: 'PLÁSTICO / PVC',
    image: '/products/kiv001_kit_viagem_baby_1769835712831.png',
    category: 'bathroom',
    stock: 50,
  },

  {
    id: 'nec007',
    ref: 'NEC007',
    name: 'Necessaire 18x10x7cm',
    price: 10.00,
    ipi: 6.5,
    masterBox: 120,
    subBox: 30,
    material: 'POLIÉSTER',
    image: '/products/nec007_necessaire_silver_1769835741574.png',
    category: 'bathroom',
    stock: 80,
  },
  {
    id: 'nec014',
    ref: 'NEC014',
    name: 'Necessaire 18x18x10 cm',
    price: 9.00,
    ipi: 6.5,
    masterBox: 150,
    subBox: 30,
    material: 'PVC / AÇO',
    image: '/products/nec014_necessaire_transparente_1769835756693.png',
    category: 'bathroom',
    stock: 200,
  },
  {
    id: '1',
    ref: 'COP055',
    name: 'Copo de Vidro 290 ml',
    price: 1.90,
    ipi: 9.75,
    masterBox: 48,
    material: 'VIDRO',
    image: '/products/cop055_copo_vidro_290ml_1769836087650.png',
    category: 'kitchen',
    stock: 15,
  },
  {
    id: '2',
    ref: 'COP066',
    name: 'Conjunto com 3 copos de vidro 200 ml',
    price: 4.50,
    ipi: 9.75,
    masterBox: 16,
    material: 'VIDRO',
    image: '/products/cop066_conjunto_copos_vidro_1769836104260.png',
    category: 'kitchen',
    stock: 24,
  },
  {
    id: '3',
    ref: 'GAR007',
    name: 'Garrafa Squeeze 1L',
    price: 12.00,
    ipi: 6.5,
    masterBox: 60,
    subBox: 30,
    material: 'PLÁSTICO',
    image: '/products/gar007_garrafa_squeeze_1l_1769836060429.png',
    category: 'hygiene',
    stock: 8,
  },
  {
    id: '4',
    ref: 'GAR009',
    name: 'Copo com LED 400ml',
    price: 5.00,
    ipi: 6.5,
    masterBox: 240,
    subBox: 36,
    material: 'PLÁSTICO',
    image: '/products/gar009_copo_led_400ml_1769836117623.png',
    category: 'toys',
    stock: 12,
  },
  {
    id: '5',
    ref: 'TAB003',
    name: 'Tábua de corte Frases',
    price: 7.50,
    masterBox: 36,
    subBox: 12,
    material: 'PLÁSTICO',
    image: '/products/tab003_tabua_corte_frases_1769836074063.png',
    category: 'kitchen',
    stock: 36,
  },
]

export function getProductById(id: string) {
  return products.find((product) => product.id === id && (product.stock ?? 0) >= 5)
}

export function getProductsByCategory(categoryId: string) {
  return products.filter((product) => product.category === categoryId && (product.stock ?? 0) >= 5)
}

export function searchProducts(query: string) {
  const lowerQuery = query.toLowerCase()
  return products.filter(
    (product) =>
      ((product.stock ?? 0) >= 5) &&
      (product.name.toLowerCase().includes(lowerQuery) ||
        product.category.toLowerCase().includes(lowerQuery))
  )
}

export function getBestSellers() {
  return products.filter((product) => product.badge === 'best-seller' && (product.stock ?? 0) >= 5)
}

export function getNewProducts() {
  return products.filter((product) => product.badge === 'new' && (product.stock ?? 0) >= 5)
}

export function getSaleProducts() {
  return products.filter((product) => (product.badge === 'sale' || product.originalPrice) && (product.stock ?? 0) >= 5)
}

export function getRelatedProducts(currentProductId: string, limit = 4) {
  const currentProduct = getProductById(currentProductId)

  if (!currentProduct) return []

  // Filter products in the same category, excluding the current one
  const related = products.filter(
    (product) =>
      product.category === currentProduct.category &&
      product.id !== currentProductId &&
      (product.stock ?? 0) >= 5
  )

  // If we don't have enough related products, fill with other random products
  if (related.length < limit) {
    const others = products.filter(
      (product) =>
        product.category !== currentProduct.category &&
        product.id !== currentProductId &&
        (product.stock ?? 0) >= 5
    )
    return [...related, ...others].slice(0, limit)
  }

  return related.slice(0, limit)
}
