export const formatTime = (hours: number | null): string => {
  if (hours === null) return "N/A";
  if (hours < 1) {
    return `${Math.round(hours * 60)} minutes`;
  } else if (hours >= 24) {
    const days = hours / 24;
    return `${days.toFixed(1)} days`;
  } else {
    return `${hours.toFixed(1)} hours`;
  }
};

export const formatCompactTime = (hours: number | null): string => {
  if (hours === null) return "N/A";

  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  } else if (hours < 24) {
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    if (minutes === 0) {
      return `${wholeHours}h`;
    } else {
      return `${wholeHours}h ${minutes}m`;
    }
  } else {
    const days = Math.floor(hours / 24);
    const remainingHours = Math.round(hours % 24);
    if (remainingHours === 0) {
      return `${days}d`;
    } else {
      return `${days}d ${remainingHours}h`;
    }
  }
};
