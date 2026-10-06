/**
 * @param {{ caption: string, headers: string[], rows: import('react').ReactNode[][], empty: string }} props
 */
export function DataTable({ caption, headers, rows, empty }) {
  return (
    <div
      className="overflow-x-auto rounded-lg border"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <table className="w-full text-left text-sm">
        <caption className="p-3 text-left text-base font-semibold">{caption}</caption>
        <thead>
          <tr style={{ color: 'var(--muted)' }}>
            {headers.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-3 py-4" style={{ color: 'var(--muted)' }}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((cells, i) => (
              <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                {cells.map((c, j) => (
                  <td key={j} className="px-3 py-2">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
