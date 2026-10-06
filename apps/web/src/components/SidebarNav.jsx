import { NavLink } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export const SIDEBAR_ICON_SIZE = 24;

// Item "pilula preenchida quando ativo". O icone fica sempre no mesmo lugar; so o rotulo some/aparece.
// Recolhido (desktop, 64px): quadrado de 36px; expandido: largura total. Controlado por data-expanded
// do <aside> (grupo nomeado `side`).
export function SidebarItem({ to, end, icon: Icon, label, onNavigate }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      title={label}
      className={({ isActive }) =>
        `flex w-full items-center gap-3 rounded-zela-md py-1.5 pr-4 pl-4 text-sm font-medium transition-all md:h-9 md:w-9 md:justify-center md:p-0 md:group-data-[expanded=true]/side:h-auto md:group-data-[expanded=true]/side:w-full md:group-data-[expanded=true]/side:justify-start md:group-data-[expanded=true]/side:py-1.5 md:group-data-[expanded=true]/side:pr-4 md:group-data-[expanded=true]/side:pl-4 ${
          isActive
            ? 'bg-primary text-white shadow-sm'
            : 'text-on-surface-variant hover:bg-surface-container-high'
        }`
      }
    >
      <Icon size={SIDEBAR_ICON_SIZE} className="shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate text-left whitespace-nowrap md:hidden md:group-data-[expanded=true]/side:inline">
        {label}
      </span>
    </NavLink>
  );
}

// Botao na borda direita do <aside>, alterna expandir/recolher.
export function SidebarToggleButton({ isExpanded, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isExpanded ? 'Recolher menu' : 'Expandir menu'}
      title={isExpanded ? 'Recolher menu' : 'Expandir menu'}
      className="absolute top-4 -right-3 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-outline-variant bg-surface-container-low shadow-sm transition-colors hover:bg-surface-container-high md:flex"
    >
      <ChevronLeft
        size={14}
        className={`transition-transform duration-300 ${isExpanded ? '' : 'rotate-180'}`}
      />
    </button>
  );
}
