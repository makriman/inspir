import { useNavigate } from 'react-router-dom';

export default function ToolCard({ tool, onClick, showStats = false, stats = null }) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (tool.route) {
      navigate(tool.route);
    } else if (onClick) {
      onClick(tool);
    }
  };

  const isLive = tool.status === 'live';

  return (
    <div
      onClick={handleClick}
      className={`
        group relative bg-white rounded-xl p-6
        border-2 border-off-white
        shadow-sm hover:shadow-lg
        transform hover:scale-105 hover:border-accent-yellow
        transition-all duration-200
        ${isLive ? 'cursor-pointer' : 'cursor-pointer opacity-90'}
        h-full flex flex-col
      `}
    >
      {/* Status Indicator */}
      {isLive ? (
        <div className="absolute top-3 right-3 w-6 h-6 text-green-500">
          ✅
        </div>
      ) : (
        <div className="absolute top-3 right-3 px-3 py-1 bg-accent-yellow text-black text-xs font-bold rounded-full">
          Coming Soon
        </div>
      )}

      {/* Icon */}
      <div className="text-6xl mb-4 text-center group-hover:scale-110 transition-transform duration-200">
        {tool.icon}
      </div>

      {/* Tool Name */}
      <h3 className="text-lg font-bold text-gray-900 mb-2 text-center">
        {tool.name}
      </h3>

      {/* Description */}
      <p className="text-sm text-gray-600 text-center mb-4 flex-grow line-clamp-2">
        {tool.description}
      </p>

      {/* Stats (for logged-in users) */}
      {showStats && stats && isLive && (
        <div className="text-xs text-gray-500 text-center mb-3 space-y-1">
          {stats.usageCount > 0 && (
            <div>Used {stats.usageCount} times</div>
          )}
          {stats.lastUsed && (
            <div>Last used: {stats.lastUsed}</div>
          )}
        </div>
      )}

      {/* Action Button/Text */}
      <div className="text-center">
        {isLive ? (
          <span className="text-primary-blue font-semibold group-hover:text-accent-red transition-colors duration-200 inline-flex items-center">
            Try It Free
            <span className="ml-1 group-hover:translate-x-1 transition-transform duration-200">
              →
            </span>
          </span>
        ) : (
          <span className="text-gray-400 font-semibold">See what’s coming</span>
        )}
      </div>

      {/* Category Badge */}
      <div className="absolute bottom-3 left-3 px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
        {tool.category}
      </div>
    </div>
  );
}
