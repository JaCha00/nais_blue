import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Ellipsis, LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface NavItem {
    path: string
    icon: LucideIcon
    labelKey: string
    fallbackLabel?: string
}

interface AnimatedNavBarProps {
    items: NavItem[]
}

const MOBILE_PRIMARY_PATHS = new Set(['/', '/scenes', '/tools', '/library'])
const LABELED_NAV_MIN_WIDTH = 1360

function isRouteActive(pathname: string, itemPath: string) {
    return itemPath === '/'
        ? pathname === '/'
        : pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

export function AnimatedNavBar({ items }: AnimatedNavBarProps) {
    const { t } = useTranslation()
    const location = useLocation()
    const navRef = useRef<HTMLElement>(null)
    const reduceMotion = useReducedMotion()
    const [{ isCompact, isTiny }, setNavigationMode] = useState(() => ({
        isCompact: true,
        isTiny: window.innerWidth < 480,
    }))

    useEffect(() => {
        const node = navRef.current
        const measuredNode = node?.parentElement ?? node
        let rafId = 0

        const syncNavigationMode = () => {
            if (rafId) {
                cancelAnimationFrame(rafId)
            }

            rafId = requestAnimationFrame(() => {
                const availableWidth = measuredNode?.getBoundingClientRect().width ?? window.innerWidth
                const nextMode = {
                    // Eleven translated labels need the measured center-panel width, not the viewport
                    // breakpoint. Below this bound the four primary icons plus More remain fully visible.
                    isCompact: window.innerWidth < 1536 || availableWidth < LABELED_NAV_MIN_WIDTH,
                    isTiny: availableWidth < 320 || window.innerWidth < 480,
                }

                setNavigationMode(previous => (
                    previous.isCompact === nextMode.isCompact && previous.isTiny === nextMode.isTiny
                        ? previous
                        : nextMode
                ))
            })
        }

        syncNavigationMode()

        const observer = typeof ResizeObserver !== 'undefined' && measuredNode
            ? new ResizeObserver(syncNavigationMode)
            : null
        if (observer && measuredNode) {
            observer.observe(measuredNode)
        } else {
            window.addEventListener('resize', syncNavigationMode)
        }

        return () => {
            if (rafId) {
                cancelAnimationFrame(rafId)
            }
            if (!observer) {
                window.removeEventListener('resize', syncNavigationMode)
            }
            observer?.disconnect()
        }
    }, [])

    const primaryItems = items.filter(item => MOBILE_PRIMARY_PATHS.has(item.path))
    const overflowItems = items.filter(item => !MOBILE_PRIMARY_PATHS.has(item.path))
    const moreLabel = t('nav.more', 'More')
    const overflowIsActive = overflowItems.some(item => isRouteActive(location.pathname, item.path))

    const renderItem = (item: NavItem, layoutId: string, showLabel: boolean) => {
        const isActive = isRouteActive(location.pathname, item.path)
        const label = t(item.labelKey, item.fallbackLabel ?? item.labelKey)

        return (
            <NavLink
                key={item.path}
                to={item.path}
                title={!showLabel ? label : undefined}
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                    'relative z-0 inline-flex h-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control border border-transparent text-sm font-medium transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                    isCompact ? (isTiny ? "h-10 w-10 p-0" : 'w-11 p-2') : 'px-3 py-2',
                    isActive
                        ? 'text-primary'
                        : 'text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'
                )}
            >
                {isActive && (
                    <motion.span
                        layoutId={layoutId}
                        className="absolute inset-0 -z-10 rounded-control border border-primary/30 bg-accent"
                        transition={reduceMotion
                            ? { duration: 0 }
                            : { type: 'tween', duration: 0.18, ease: [0.2, 0, 0, 1] }}
                    />
                )}
                <span className="relative z-10 flex min-w-0 items-center gap-2">
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {showLabel && <span className="truncate">{label}</span>}
                </span>
            </NavLink>
        )
    }

    return (
        <nav
            ref={navRef}
            aria-label={t('nav.navigation', 'Primary navigation')}
            className={cn(
                'flex w-full min-w-0 items-center overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                isTiny ? "justify-start" : "justify-center",
            )}
        >
            {/* DESIGN.md keeps compact navigation deterministic: four work routes plus one overflow at <640px. */}
            <div className="flex w-full min-w-0 items-center justify-between gap-0 sm:hidden">
                {primaryItems.map(item => renderItem(item, 'activeTab-mobile', false))}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label={moreLabel}
                            title={moreLabel}
                            className={cn(
                                'inline-flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-control border text-sm transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                                overflowIsActive
                                    ? 'border-primary/30 bg-accent text-primary'
                                    : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'
                            )}
                        >
                            <Ellipsis className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        sideOffset={8}
                        className="w-56 rounded-panel border-border bg-popover p-1 text-popover-foreground shadow-panel"
                    >
                        {overflowItems.map(item => {
                            const isActive = isRouteActive(location.pathname, item.path)
                            const label = t(item.labelKey, item.fallbackLabel ?? item.labelKey)

                            return (
                                <DropdownMenuItem
                                    key={item.path}
                                    asChild
                                    className={cn(
                                        'h-11 rounded-control px-3 focus:bg-accent focus:text-accent-foreground',
                                        isActive && 'bg-accent text-primary'
                                    )}
                                >
                                    <NavLink
                                        to={item.path}
                                        aria-current={isActive ? 'page' : undefined}
                                        className="flex w-full items-center gap-3"
                                    >
                                        <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                                        <span className="truncate">{label}</span>
                                    </NavLink>
                                </DropdownMenuItem>
                            )
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Compact desktop shares the four core routes with mobile; the overflow menu prevents utility controls from squeezing eleven tabs. */}
            <div className={cn(
                'hidden w-full min-w-0 items-center justify-center sm:flex',
                isCompact ? 'gap-0' : 'gap-1',
            )}>
                {(isCompact ? primaryItems : items).map(item => renderItem(item, 'activeTab-desktop', !isCompact))}
                {isCompact && overflowItems.length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label={moreLabel}
                                title={moreLabel}
                                className={cn(
                                    'inline-flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-control border transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                                    overflowIsActive
                                        ? 'border-primary/30 bg-accent text-primary'
                                        : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground',
                                )}
                            >
                                <Ellipsis className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            sideOffset={8}
                            className="w-56 rounded-panel border-border bg-popover p-1 text-popover-foreground shadow-panel"
                        >
                            {overflowItems.map(item => {
                                const isActive = isRouteActive(location.pathname, item.path)
                                const label = t(item.labelKey, item.fallbackLabel ?? item.labelKey)
                                return (
                                    <DropdownMenuItem
                                        key={item.path}
                                        asChild
                                        className={cn(
                                            'h-11 rounded-control px-3 focus:bg-accent focus:text-accent-foreground',
                                            isActive && 'bg-accent text-primary',
                                        )}
                                    >
                                        <NavLink to={item.path} aria-current={isActive ? 'page' : undefined} className="flex w-full items-center gap-3">
                                            <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                                            <span className="truncate">{label}</span>
                                        </NavLink>
                                    </DropdownMenuItem>
                                )
                            })}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </nav>
    )
}
