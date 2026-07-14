import type { KeyboardEventHandler, MouseEventHandler } from 'react'

export interface DiagnosticDrawerTriggerProps {
    type: 'button'
    'aria-haspopup': 'dialog'
    onClick: MouseEventHandler<HTMLButtonElement>
    onKeyDown: KeyboardEventHandler<HTMLButtonElement>
}

/** Native buttons give touch click behavior; this keeps explicit keyboard parity. */
export function getDiagnosticDrawerTriggerProps(open: () => void): DiagnosticDrawerTriggerProps {
    return {
        type: 'button',
        'aria-haspopup': 'dialog',
        onClick: open,
        onKeyDown: event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                open()
            }
        },
    }
}
