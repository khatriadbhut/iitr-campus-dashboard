import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A small in-app dropdown, replacing a native <select>.
 *
 * A native select cannot be styled where it actually matters: the OPTION LIST is drawn by the
 * operating system, so on Android it opened as a black sheet in the OS palette with none of the app's
 * colours or type — the one part of the filter bar that looked like it belonged to a different
 * application. -webkit-appearance:none restyles the closed control and changes nothing about the
 * popup, which is why the old one still looked generic.
 *
 * Keyboard behaviour is kept deliberately close to the native control it replaces, because a listbox
 * that traps focus or ignores Escape is a worse outcome than an ugly popup:
 *   · Enter/Space open, Escape closes and returns focus to the trigger
 *   · Up/Down move through options, Home/End jump to the ends
 *   · a click anywhere outside closes it
 */
const FilterDropdown = ({ value, onChange, options, icon = null, ariaLabel, className = '' }) => {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
    const rootRef = useRef(null);
    const btnRef = useRef(null);

    const selected = options.find((o) => o.value === value) || options[0];

    useEffect(() => {
        if (!open) return undefined;
        const onDocClick = (e) => {
            if (rootRef.current && rootRef.current.contains(e.target)) return;
            // DISMISS ONLY. Without swallowing this click, closing the menu by clicking the feed also
            // opened the card underneath — one tap, two outcomes, one of them a full navigation away
            // from the list you were filtering. A native select eats the dismissing click too.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
        };
        // Capture, so this runs before the card's own handler rather than after it.
        document.addEventListener('click', onDocClick, true);
        return () => document.removeEventListener('click', onDocClick, true);
    }, [open]);

    const choose = (v) => {
        onChange(v);
        setOpen(false);
        btnRef.current?.focus();
    };

    const onKeyDown = (e) => {
        if (!open) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(Math.max(0, options.findIndex((o) => o.value === value)));
                setOpen(true);
            }
            return;
        }
        if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btnRef.current?.focus(); return; }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active].value); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }
        if (e.key === 'Home') { e.preventDefault(); setActive(0); return; }
        if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    };

    return (
        <div className={`app-dropdown ${className}`} ref={rootRef}>
            <button
                ref={btnRef}
                type="button"
                className={`app-dropdown-trigger ${open ? 'open' : ''}`}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={ariaLabel}
                onClick={() => setOpen((o) => !o)}
                onKeyDown={onKeyDown}
            >
                {icon}
                <span className="app-dropdown-value">{selected?.label}</span>
                <ChevronDown size={14} className="app-dropdown-caret" />
            </button>

            {open && (
                <ul className="app-dropdown-menu" role="listbox" aria-label={ariaLabel} tabIndex={-1}>
                    {options.map((o, i) => (
                        <li
                            key={o.value}
                            role="option"
                            aria-selected={o.value === value}
                            className={`app-dropdown-option ${o.value === value ? 'selected' : ''} ${i === active ? 'active' : ''}`}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => choose(o.value)}
                        >
                            {o.label}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default FilterDropdown;
