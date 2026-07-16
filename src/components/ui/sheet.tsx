"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { isAndroidRuntime } from "@/platform/runtime"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <SheetPrimitive.Overlay
        className={cn(
            "fixed inset-0 z-50 bg-scrim/[0.72] ease-standard data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:duration-overlay data-[state=open]:duration-overlay motion-reduce:animate-none motion-reduce:transition-none",
            className
        )}
        {...props}
        ref={ref}
    />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

// DESIGN.md binds every sheet edge to all four safe-area insets so Android landscape cannot clip controls.
const sheetVariants = cva(
    "fixed z-50 gap-4 border-border bg-card pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] text-card-foreground shadow-panel transition duration-overlay ease-standard data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-overlay data-[state=open]:duration-overlay motion-reduce:animate-none motion-reduce:transition-none",
    {
        variants: {
            side: {
                top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
                bottom:
                    "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                left: "inset-y-0 left-0 h-full w-full max-w-none border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
                right:
                    "inset-y-0 right-0 h-full w-full max-w-none border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            },
        },
        defaultVariants: {
            side: "right",
        },
    }
)

interface SheetContentProps
    extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
    closeLabel?: string
}

const SheetContent = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Content>,
    SheetContentProps
>(({ side = "right", className, children, closeLabel = "Close", style, ...props }, ref) => (
    <SheetPortal>
        <SheetOverlay />
        <SheetPrimitive.Content
            ref={ref}
            className={cn(sheetVariants({ side }), className)}
            // Portals do not inherit the mobile shell padding. Android OEM WebViews may also report
            // zero env() insets, so the common sheet boundary keeps all sheet actions above system bars.
            style={isAndroidRuntime ? {
                ...style,
                paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
                paddingBottom: 'max(3.5rem, env(safe-area-inset-bottom))',
            } : style}
            {...props}
        >
            <SheetPrimitive.Close
                aria-label={closeLabel}
                className={cn(
                    "absolute right-[max(1rem,env(safe-area-inset-right))] z-10 inline-flex h-11 w-11 items-center justify-center rounded-control border border-transparent text-muted-foreground transition-colors duration-standard hover:border-border hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50",
                    isAndroidRuntime
                        ? "top-[max(1.5rem,env(safe-area-inset-top))]"
                        : "top-[max(1rem,env(safe-area-inset-top))]",
                )}
            >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{closeLabel}</span>
            </SheetPrimitive.Close>
            {children}
        </SheetPrimitive.Content>
    </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            // The 64px end reserve prevents title/actions from occupying the close button hit box.
            "flex min-h-11 flex-col justify-center gap-2 pr-16 text-left",
            className
        )}
        {...props}
    />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
            className
        )}
        {...props}
    />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
    <SheetPrimitive.Title
        ref={ref}
        className={cn("text-base font-semibold text-foreground", className)}
        {...props}
    />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
    <SheetPrimitive.Description
        ref={ref}
        className={cn("text-sm text-muted-foreground", className)}
        {...props}
    />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
    Sheet,
    SheetPortal,
    SheetOverlay,
    SheetTrigger,
    SheetClose,
    SheetContent,
    SheetHeader,
    SheetFooter,
    SheetTitle,
    SheetDescription,
}
