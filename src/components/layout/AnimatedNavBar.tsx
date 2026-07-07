import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface NavItem {
    path: string
    icon: LucideIcon
    labelKey: string
    fallbackLabel?: string
}

interface AnimatedNavBarProps {
    items: NavItem[]
}

export function AnimatedNavBar({ items }: AnimatedNavBarProps) {
    const { t } = useTranslation()
    const location = useLocation()
    const navRef = useRef<HTMLElement>(null)
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
                    isCompact: window.innerWidth < 1382 || availableWidth < 760,
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

    return (
        <nav ref={navRef} className="flex w-full min-w-0 items-center justify-center gap-1 overflow-x-auto p-1">
            {items.map((item) => {
                const isActive = location.pathname === item.path
                const label = t(item.labelKey, item.fallbackLabel ?? item.labelKey)
                return (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        title={isCompact ? label : undefined}
                        className={cn(
                            "relative z-0 shrink-0 rounded-full text-sm font-medium transition-colors",
                            isCompact ? (isTiny ? "p-1.5" : "p-2") : "px-4 py-2",
                            isActive
                                ? "text-foreground"
                                : "text-muted-foreground hover:text-foreground/80"
                        )}
                    >
                        {isActive && (
                            <motion.div
                                layoutId="activeTab"
                                className="absolute inset-0 bg-foreground/10 backdrop-blur-md rounded-full border border-foreground/10 shadow-sm -z-10"
                                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                            />
                        )}
                        <span className="relative z-10 flex min-w-0 items-center gap-2">
                            <item.icon className="h-4 w-4 shrink-0" />
                            {!isCompact && <span className="truncate">{label}</span>}
                        </span>
                    </NavLink>
                )
            })}
        </nav>
    )
}
