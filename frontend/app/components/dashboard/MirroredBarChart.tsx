export interface LanguageStats {
  languageName: string;
  countPercentage: number;
  sizePercentage: number;
}

interface MirroredBarChartProps {
  data: LanguageStats[];
  className?: string;
}

function clampPercentage(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

export function MirroredBarChart({ data, className = "" }: MirroredBarChartProps) {
  if (!data?.length) {
    return (
      <div className={`text-xs text-muted-foreground ${className}`}>
        No file distribution data available.
      </div>
    );
  }

  return (
    <div className={`w-full max-w-[400px] space-y-2 text-sm ${className}`}>
      {data.map((item) => {
        const count = clampPercentage(item.countPercentage);
        const size = clampPercentage(item.sizePercentage);
        const countWidth = count === 0 ? 1 : count;
        const sizeWidth = size === 0 ? 1 : size;

        return (
          <div
            key={item.languageName}
            className="grid grid-cols-[4rem_1fr_7rem_1fr_2.5rem] items-center"
          >
            <span className="text-right text-gray-300 pr-1">{count}%</span>
            <div className="relative h-1.5 overflow-visible">
              <span
                className="absolute right-0 top-0 h-1.5 rounded-full bg-sky-500/80"
                style={{ width: `${countWidth}%` }}
              />
            </div>

            <div className="text-center font-medium text-gray-100 px-1">
              {item.languageName.toLowerCase()}
            </div>

            <div className="relative h-1.5 overflow-visible">
              <span
                className="absolute left-0 top-0 h-1.5 rounded-full bg-purple-500/80"
                style={{ width: `${sizeWidth}%` }}
              />
            </div>
            <span className="text-left text-gray-300 pl-1">{size}%</span>
          </div>
        );
      })}
    </div>
  );
}
