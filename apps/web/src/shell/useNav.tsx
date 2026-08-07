import { createContext, useContext, type ReactNode } from 'react';
import { SubNav } from './ui/layout.js';
import type { NavItem } from '../modules/types.js';

const NavContext = createContext<NavItem[]>([]);

export function NavProvider({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

/**
 * What a hub page owns, straight from the manifests.
 *
 * `hidden: true` on a navigation entry means "registered, routed, and not in the rail",
 * and the contract that defines it says the point is that a hub can enumerate what it
 * owns. Nothing ever did, so four finance pages were hidden from the rail and listed
 * nowhere else — reachable only by typing the address or already knowing they existed.
 *
 * Reading it from the manifests rather than writing the list into the page keeps one
 * source of truth: a module that adds a page gets a tab for it without the hub knowing.
 */
export function useSection(section: string): NavItem[] {
  return useContext(NavContext)
    .filter((i) => i.section === section)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label));
}

/**
 * The tab strip for a section, for the `tabs` slot on PageHeader.
 *
 * Every page in the section renders the same strip, so moving between them keeps the strip
 * on screen and the whole section reads as one place with modes rather than as five
 * destinations that happen to be about money.
 */
export function SectionTabs({ section }: { section: string }) {
  const items = useSection(section);
  return <SubNav items={items.map((i) => ({ label: i.label, to: i.path }))} />;
}
