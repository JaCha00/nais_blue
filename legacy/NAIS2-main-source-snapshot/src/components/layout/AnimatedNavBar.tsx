import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'
import { useState, useEffect } from 'react'

interface NavItem {
    path: string
    icon: LucideIcon
    labelKey: string
}

interface AnimatedNavBarProps {
    items: NavItem[]
}

export function AnimatedNavBar({ items }: AnimatedNavBarProps) {
    const { t } = useTranslation()
    const location = useLocation()
    const [isCompact, setIsCompact] = useState(window.innerWidth < 1382)

    useEffect(() => {
        const handleResize = () => {
            setIsCompact(window.innerWidth < 1382)
        }
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    return (
        <nav className="flex items-center gap-1 p-1">
            {items.map((item) => {
                const isActive = location.pathname === item.path
                return (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        title={isCompact ? t(item.labelKey) : undefined}
                        className={cn(
                            "relative rounded-full text-sm font-medium transition-colors z-0",
                            isCompact ? "p-2" : "px-4 py-2",
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
                        <span className="flex items-center gap-2 relative z-10">
                            <item.icon className="h-4 w-4" />
                            {!isCompact && <span>{t(item.labelKey)}</span>}
                        </span>
                    </NavLink>
                )
            })}
        </nav>
    )
}
