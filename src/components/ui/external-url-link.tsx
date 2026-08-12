import type { ButtonHTMLAttributes } from 'react'

import { openExternalUrl } from '@/platform/browser'

interface ExternalUrlLinkProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
    readonly href: string
}

/** Link-styled control that works in both the Tauri shell and a web preview. */
export function ExternalUrlLink({ href, onClick, ...props }: ExternalUrlLinkProps) {
    return (
        <button
            type="button"
            {...props}
            onClick={event => {
                onClick?.(event)
                if (!event.defaultPrevented) {
                    void openExternalUrl(href).catch(error => {
                        console.error('[ExternalUrlLink] Failed to open URL', error)
                    })
                }
            }}
        />
    )
}
