import { useState, useEffect } from 'react';
import { Clock, ToggleLeft, ToggleRight } from 'lucide-react';

const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
] as const;

type DayKey = typeof DAYS[number]['key'];

interface DaySchedule {
  enabled: boolean;
  open: string;
  close: string;
}

interface OpeningHoursEditorProps {
  value: string;
  onChange: (json: string) => void;
}

function parseJson(json: string): Record<DayKey, DaySchedule> {
  const defaults: Record<DayKey, DaySchedule> = {
    mon: { enabled: true, open: '09:00', close: '18:00' },
    tue: { enabled: true, open: '09:00', close: '18:00' },
    wed: { enabled: true, open: '09:00', close: '18:00' },
    thu: { enabled: true, open: '09:00', close: '18:00' },
    fri: { enabled: true, open: '09:00', close: '18:00' },
    sat: { enabled: false, open: '10:00', close: '14:00' },
    sun: { enabled: false, open: '10:00', close: '14:00' },
  };

  if (!json) return defaults;

  try {
    const parsed = JSON.parse(json);
    const week = parsed.week || {};
    for (const day of DAYS) {
      const slots = week[day.key];
      if (Array.isArray(slots) && slots.length > 0) {
        defaults[day.key] = {
          enabled: true,
          open: slots[0].open || '09:00',
          close: slots[0].close || '18:00',
        };
      } else if (Array.isArray(slots) && slots.length === 0) {
        defaults[day.key] = { ...defaults[day.key], enabled: false };
      }
    }
  } catch {
    // ignore parse errors
  }

  return defaults;
}

function toJson(schedule: Record<DayKey, DaySchedule>): string {
  const week: Record<string, { open: string; close: string }[]> = {};
  for (const day of DAYS) {
    const s = schedule[day.key];
    week[day.key] = s.enabled ? [{ open: s.open, close: s.close }] : [];
  }
  return JSON.stringify({
    version: '1.0',
    timezone: 'UTC',
    week,
    exceptions: [],
    always_open: false,
    notes: ''
  });
}

export function OpeningHoursEditor({ value, onChange }: OpeningHoursEditorProps) {
  const [schedule, setSchedule] = useState(() => parseJson(value));

  useEffect(() => {
    onChange(toJson(schedule));
  }, [schedule]);

  const updateDay = (day: DayKey, updates: Partial<DaySchedule>) => {
    setSchedule(prev => ({
      ...prev,
      [day]: { ...prev[day], ...updates }
    }));
  };

  const applyToWeekdays = (day: DayKey) => {
    const source = schedule[day];
    setSchedule(prev => {
      const next = { ...prev };
      for (const d of ['mon', 'tue', 'wed', 'thu', 'fri'] as DayKey[]) {
        next[d] = { ...source };
      }
      return next;
    });
  };

  const inputClass = "px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Opening Hours</span>
      </div>

      <div className="space-y-2">
        {DAYS.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-3">
            {/* Toggle */}
            <button
              type="button"
              onClick={() => updateDay(key, { enabled: !schedule[key].enabled })}
              className="flex-shrink-0"
              title={schedule[key].enabled ? 'Close this day' : 'Open this day'}
            >
              {schedule[key].enabled ? (
                <ToggleRight className="w-7 h-7 text-green-500" />
              ) : (
                <ToggleLeft className="w-7 h-7 text-gray-300 dark:text-gray-600" />
              )}
            </button>

            {/* Day label */}
            <span className={`w-20 text-sm font-medium ${schedule[key].enabled ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
              {label}
            </span>

            {/* Time inputs */}
            {schedule[key].enabled ? (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={schedule[key].open}
                  onChange={e => updateDay(key, { open: e.target.value })}
                  className={inputClass}
                />
                <span className="text-gray-400 dark:text-gray-500 text-sm">—</span>
                <input
                  type="time"
                  value={schedule[key].close}
                  onChange={e => updateDay(key, { close: e.target.value })}
                  className={inputClass}
                />
                {/* Apply to weekdays button (only show on weekdays) */}
                {['mon', 'tue', 'wed', 'thu', 'fri'].includes(key) && (
                  <button
                    type="button"
                    onClick={() => applyToWeekdays(key)}
                    className="text-xs text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 whitespace-nowrap ml-1"
                    title="Apply these hours to all weekdays"
                  >
                    Apply to Mon-Fri
                  </button>
                )}
              </div>
            ) : (
              <span className="text-sm text-gray-400 dark:text-gray-500 italic">Closed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
