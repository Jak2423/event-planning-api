import { supabase } from "./supabase.js"

type OrderItemJson = {
	venueId?: string
	categoryLabel?: string
	name?: string
	price?: number
}

export type OrderRow = {
	id: string
	user_id: string | null
	customer_name: string
	customer_email: string
	customer_phone: string
	payment_method: string
	notes: string | null
	items: unknown
	subtotal: number
	total: number
	status: string
	created_at: string
}

export const getProviderVenueIds = async (providerId: string): Promise<string[]> => {
	const { data, error } = await supabase.from("venues").select("id").eq("provider_id", providerId)

	if (error) {
		console.error("provider venues", error)
		return []
	}

	return (data ?? []).map((r) => r.id as string)
}

const parseItems = (items: unknown): OrderItemJson[] => (Array.isArray(items) ? items : []) as OrderItemJson[]

export const orderTouchesVenues = (order: Pick<OrderRow, "items">, venueIds: Set<string>): boolean => {
	if (venueIds.size === 0) return false
	return parseItems(order.items).some((i) => i.venueId != null && venueIds.has(i.venueId))
}

export const providerShareFromOrder = (order: Pick<OrderRow, "items">, venueIds: Set<string>): number => {
	if (venueIds.size === 0) return 0
	return parseItems(order.items)
		.filter((i) => i.venueId != null && venueIds.has(i.venueId))
		.reduce((s, i) => s + (Number(i.price) || 0), 0)
}

export const eventTypeLabelForProvider = (order: Pick<OrderRow, "items">, venueIds: Set<string>): string => {
	if (venueIds.size === 0) return "—"
	const hit = parseItems(order.items).find((i) => i.venueId != null && venueIds.has(i.venueId))
	return hit?.categoryLabel?.trim() || hit?.name?.trim() || "—"
}

export const displayOrderRef = (id: string): string => {
	const compact = id.replace(/-/g, "").toUpperCase()
	return `#NR-${compact.slice(-6)}`
}

/** UTC calendar month bounds: `monthsAgo` 0 = current month, 1 = previous month. */
export const calendarMonthBoundsUtc = (monthsAgo: number): { start: Date; end: Date } => {
	const now = new Date()
	const y = now.getUTCFullYear()
	const m = now.getUTCMonth() - monthsAgo
	const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0))
	const end = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0))
	return { start, end }
}

export const pctChange = (current: number, previous: number): number | null => {
	if (previous === 0) return current > 0 ? null : 0
	return Math.round(((current - previous) / previous) * 1000) / 10
}

export const fetchRecentOrders = async (maxRows: number): Promise<OrderRow[]> => {
	const { data, error } = await supabase
		.from("orders")
		.select(
			"id, user_id, customer_name, customer_email, customer_phone, payment_method, notes, items, subtotal, total, status, created_at",
		)
		.order("created_at", { ascending: false })
		.limit(maxRows)

	if (error) {
		console.error("orders fetch for provider", error)
		return []
	}

	return (data ?? []) as OrderRow[]
}
