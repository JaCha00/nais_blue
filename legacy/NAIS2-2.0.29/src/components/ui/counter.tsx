import { motion, useSpring, useTransform } from 'framer-motion'
import { useEffect, useState, useRef } from 'react'
import { Minus, Plus } from 'lucide-react'

import './counter.css'

interface CounterProps {
    value: number
    onChange: (value: number) => void
    min?: number
    max?: number
    fontSize?: number
    className?: string
}

function Number({ mv, number, height }: { mv: ReturnType<typeof useSpring>; number: number; height: number }) {
    const y = useTransform(mv, (latest: number) => {
        const placeValue = latest % 10
        const offset = (10 + number - placeValue) % 10
        let memo = offset * height
        if (offset > 5) {
            memo -= 10 * height
        }
        return memo
    })
    return (
        <motion.span className="counter-number" style={{ y }}>
            {number}
        </motion.span>
    )
}

function Digit({ place, value, height }: { place: number; value: number; height: number }) {
    const valueRoundedToPlace = Math.floor(value / place)
    const animatedValue = useSpring(valueRoundedToPlace, { stiffness: 300, damping: 30 })

    useEffect(() => {
        animatedValue.set(valueRoundedToPlace)
    }, [animatedValue, valueRoundedToPlace])

    return (
        <div className="counter-digit" style={{ height }}>
            {Array.from({ length: 10 }, (_, i) => (
                <Number key={i} mv={animatedValue} number={i} height={height} />
            ))}
        </div>
    )
}

// Calculate required places based on value
function getPlaces(value: number): number[] {
    if (value >= 1000) return [1000, 100, 10, 1]
    if (value >= 100) return [100, 10, 1]
    if (value >= 10) return [10, 1]
    return [1]
}

export default function Counter({
    value,
    onChange,
    min = 1,
    max = 9999,
    fontSize = 20,
    className = '',
}: CounterProps) {
    const height = fontSize + 4
    const [isEditing, setIsEditing] = useState(false)
    const [inputValue, setInputValue] = useState(String(value))
    const inputRef = useRef<HTMLInputElement>(null)

    // Sync input value when value changes externally
    useEffect(() => {
        if (!isEditing) {
            setInputValue(String(value))
        }
    }, [value, isEditing])

    // Focus input when entering edit mode
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    const handleDecrement = () => {
        if (value > min) {
            onChange(value - 1)
        }
    }

    const handleIncrement = () => {
        if (value < max) {
            onChange(value + 1)
        }
    }

    const handleConfirm = () => {
        const parsed = parseInt(inputValue, 10)
        if (!isNaN(parsed)) {
            const clamped = Math.max(min, Math.min(max, parsed))
            onChange(clamped)
        }
        setIsEditing(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleConfirm()
        } else if (e.key === 'Escape') {
            setInputValue(String(value))
            setIsEditing(false)
        }
    }

    const places = getPlaces(value)

    return (
        <div className={`counter-container ${className}`}>
            <button
                type="button"
                onClick={handleDecrement}
                disabled={value <= min}
                className="counter-button"
            >
                <Minus className="w-3 h-3" />
            </button>
            {isEditing ? (
                <input
                    ref={inputRef}
                    type="number"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onBlur={handleConfirm}
                    onKeyDown={handleKeyDown}
                    className="counter-input"
                    style={{ fontSize, height, width: `${Math.max(2, inputValue.length + 1)}ch` }}
                    min={min}
                    max={max}
                />
            ) : (
                <div
                    className="counter-display"
                    style={{ fontSize, height }}
                    onClick={() => setIsEditing(true)}
                    title="Click to edit"
                >
                    {places.map((place) => (
                        <Digit key={place} place={place} value={value} height={height} />
                    ))}
                </div>
            )}
            <button
                type="button"
                onClick={handleIncrement}
                disabled={value >= max}
                className="counter-button"
            >
                <Plus className="w-3 h-3" />
            </button>
        </div>
    )
}
