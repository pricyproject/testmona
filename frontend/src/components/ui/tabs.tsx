import * as React from "react"
import { cn } from "@/lib/utils"

const TabsContext = React.createContext<{
  value: string
  onValueChange: (value: string) => void
} | null>(null)

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, defaultValue, value, onValueChange, children, ...props }, ref) => {
    const [internalValue, setInternalValue] = React.useState(defaultValue || "")

    const contextValue = React.useMemo(() => ({
      value: value ?? internalValue,
      onValueChange: onValueChange ?? setInternalValue,
    }), [value, internalValue, onValueChange])

    return (
      <TabsContext.Provider value={contextValue}>
        <div ref={ref} className={cn("tm-tabs", className)} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    )
  }
)
Tabs.displayName = "Tabs"

const TabsList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="tablist"
    className={cn(
      "tm-tabs-list inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = "TabsList"

const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }
>(({ className, value, onKeyDown, ...props }, ref) => {
  const context = React.useContext(TabsContext)
  if (!context) throw new Error("TabsTrigger must be used within Tabs")

  const isActive = context.value === value

  // Arrow-key navigation between tabs is the expected keyboard contract for a tablist;
  // Tab alone moves out of the strip, leaving the other tabs unreachable without a mouse.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    const list = event.currentTarget.closest('[role="tablist"]')
    if (!list) return
    const triggers = Array.from(
      list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])')
    )
    const index = triggers.indexOf(event.currentTarget)
    if (index === -1) return
    const isRtl = getComputedStyle(list).direction === "rtl"
    const forward = isRtl ? "ArrowLeft" : "ArrowRight"
    const backward = isRtl ? "ArrowRight" : "ArrowLeft"
    let next: number
    if (event.key === forward || event.key === "Home") next = 0
    else if (event.key === backward || event.key === "End") next = triggers.length - 1
    else return
    event.preventDefault()
    triggers[next]?.focus()
    triggers[next]?.click()
  }

  return (
    <button
      ref={ref}
      role="tab"
      type="button"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      data-state={isActive ? "active" : "inactive"}
      className={cn(
        "tm-tabs-trigger inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        isActive
          ? "bg-background text-foreground shadow-xs"
          : "hover:bg-muted hover:text-foreground",
        className
      )}
      onClick={() => context.onValueChange(value)}
      onKeyDown={handleKeyDown}
      {...props}
    />
  )
})
TabsTrigger.displayName = "TabsTrigger"

const TabsContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value: string }
>(({ className, value, ...props }, ref) => {
  const context = React.useContext(TabsContext)
  if (!context) throw new Error("TabsContent must be used within Tabs")

  if (context.value !== value) return null

  return (
    <div
      ref={ref}
      role="tabpanel"
      tabIndex={0}
      data-state="active"
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    />
  )
})
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }
