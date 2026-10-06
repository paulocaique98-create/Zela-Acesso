/**
 * @param {{ caption: string, headers: string[], rows: import('react').ReactNode[][], empty: string }} props
 */
export function DataTable({ caption, headers, rows, empty }) {
  return (
    <div className="overflow-x-auto rounded-zela-lg border border-outline-variant bg-surface-container-lowest">
      <table className="w-full text-left text-sm">
        <caption className="p-4 text-left text-h3 text-on-surface">{caption}</caption>
        <thead>
          <tr className="bg-surface-container-low text-caption tracking-wide text-on-surface-variant uppercase">
            {headers.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={headers.length}
                className="px-4 py-10 text-center text-on-surface-variant"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((cells, i) => (
              <tr
                key={i}
                className="border-t border-outline-variant/60 transition-colors hover:bg-surface-container-low/60"
              >
                {cells.map((c, j) => (
                  <td key={j} className="px-4 py-3 text-on-surface">
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
