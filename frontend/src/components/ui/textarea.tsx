import * as React from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  dir?: 'ltr' | 'rtl' | 'auto';
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, dir, ...props }, ref) => {
    const resolvedDir = dir === 'auto' ? undefined : dir;
    return (
      <textarea
        className={cn(
          "tm-textarea flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        dir={resolvedDir}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
