// MMM-MonthlyCalendar.js

function el(tag, options) {
  var result = document.createElement(tag);

  options = options || {};
  for (var key in options) {
    result[key] = options[key];
  }

  return result;
}

function addOneDay(d) {
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + 1,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds()
  );
}

function diffDays(a, b) {
  a = new Date(a);
  b = new Date(b);

  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);

  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

// Adapted from https://stackoverflow.com/a/6117889/245795
function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - d.getUTCDay());
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function equals(a, b) {
  if (typeof a !== typeof b) {
    return false;
  }

  if (!!a && (a.constructor === Array || a.constructor === Object)) {
    for (var key in a) {
      if (!b.hasOwnProperty(key) || !equals(a[key], b[key])) {
        return false;
      }
    }

    return true;
  } else if (!!a && a.constructor == Date) {
    return a.valueOf() === b.valueOf();
  }

  return a === b;
}

function getLuminance(color) {
  try {
    const [r, g, b, a, s, d] = color.match(/([0-9.]+)/g);
    return 0.299 * +r + 0.587 * +g + 0.114 * +b;
  } catch {
    return 0;
  }
}

Module.register('MMM-MonthlyCalendar', {
  // Default module config
  defaults: {
    mode: 'currentMonth',
    firstDayOfWeek: 'sunday',
    showWeekNumber: false,
    displaySymbol: false,
    wrapTitles: false,
    hideCalendars: [],
    luminanceThreshold: 110,
    displayTime: true,
    moduleHeight: '100%',
    moduleWidth: '100%',
    cellHeightPixels: 100,
    fontSizePixels: 16,
    duplicateEventColor: 'rgba(100,100,100,1.0)',
  },

  start: function () {
    var self = this;

    self.sourceEvents = {};
    self.events = [];
    self.displayedDay = null;
    self.displayedEvents = [];
    self.updateTimer = null;
    self.skippedUpdateCount = 0;
  },

  notificationReceived: function (notification, payload, sender) {
    var self = this;

    if (notification === 'CALENDAR_EVENTS') {
      self.sourceEvents[sender.identifier] = payload
        .map(e => {
          e.startDate = new Date(+e.startDate);
          e.endDate = new Date(+e.endDate);

          if (e.fullDayEvent) {
            e.endDate = new Date(e.endDate.getTime() - 1000);

            if (e.startDate > e.endDate) {
              e.startDate = new Date(
                e.endDate.getFullYear(),
                e.endDate.getMonth(),
                e.endDate.getDate(),
                1
              );
            } else {
              e.startDate = new Date(e.startDate.getTime() + 60 * 60 * 1000);
            }
          }

          return e;
        })
        .filter(e => {
          return !self.config.hideCalendars.includes(e.calendarName);
        })
        .filter(e => {
          return !(e.calendarName === undefined);
        });

      if (self.updateTimer !== null) {
        clearTimeout(self.updateTimer);
        ++self.skippedUpdateCount;
      }

      self.updateTimer = setTimeout(() => {
        var today = new Date().setHours(12, 0, 0, 0).valueOf();

        self.events = Object.values(self.sourceEvents)
          .reduce((acc, cur) => acc.concat(cur), [])
          .sort((a, b) => {
            return a.startDate - b.startDate;
          });

        self.deDupEvents();

        if (
          today !== self.displayedDay ||
          !equals(self.events, self.displayedEvents)
        ) {
          self.displayedDay = today;
          self.displayedEvents = self.events;
          self.updateTimer = null;
          self.skippedUpdateCount = 0;
          self.updateDom();
        }
      }, 5000);
    }
  },

  deDupEvents: function () {
    var self = this;
    const ALL_CALENDARS = 'ALL';
    var calendarSets = {};
    var eventMap = {};
    calendarSets[ALL_CALENDARS] = new Set();

    for (var i in self.events) {
      let ev = self.events[i];
      let eventId = ev.title + ev.startDate.toString() + ev.endDate.toString();
      let calendar = ev.calendarName;
      if (!(calendar in calendarSets)) {
        calendarSets[calendar] = new Set();
      }

      if (calendarSets[ALL_CALENDARS].has(eventId)) {
        if (calendarSets[calendar].has(eventId)) {
          continue;
        }
        ev.color = self.config.duplicateEventColor;
      }

      calendarSets[ALL_CALENDARS].add(eventId);
      calendarSets[calendar].add(eventId);
      eventMap[eventId] = ev;
    }

    self.events = eventMap;
  },

  getStyles: function () {
    return ['MMM-MonthlyCalendar.css'];
  },

  getDom: function () {
    const days = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];
    const weeksToMonthDays = {
      nextoneweek: 0,
      currentweek: 0,
      oneweek: 0,
      twoweeks: 7,
      threeweeks: 14,
      fourweeks: 21,
      nextfourweeks: 21,
    };
    const self = this;
    const now = new Date();
    const table = el('table', {
      className: 'small wrapper',
    });
    const today = now.getDate();
    const mode = self.config.mode.toLowerCase();
    var moduleWrapper = el('div', {
      className: 'module-wrapper',
    });
    let firstDayOfWeek = self.config.firstDayOfWeek.toLowerCase();
    var row = el('tr');
    var cell;
    var cellContents;
    var cellIndex, monthDays;
    var dateCells = [];
    var eventsInCell = [];
    var eventDivsForCell = {};
    var startDayOffset = 0;

    moduleWrapper.style.maxHeight = self.config.moduleHeight;
    moduleWrapper.style.maxWidth = self.config.moduleWidth;
    const eventHeight = self.config.fontSizePixels + 1 + 4; // From the css .event margin and border
    const maxEvents = Math.floor(self.config.cellHeightPixels / eventHeight);

    moduleWrapper.appendChild(table);

    if (firstDayOfWeek === 'today') {
      firstDayOfWeek = days[now.getDay()].toLowerCase();
    }

    while (
      firstDayOfWeek !== days[0].toLowerCase() &&
      startDayOffset < days.length
    ) {
      days.push(days.shift());
      ++startDayOffset;
    }

    startDayOffset = startDayOffset % 7;

    if (mode in weeksToMonthDays) {
      cellIndex = today - now.getDay() + startDayOffset;
      while (cellIndex > today) {
        cellIndex -= 7;
      }
      monthDays = cellIndex + weeksToMonthDays[mode];
    } else {
      if (mode === 'lastmonth') {
        now.setMonth(now.getMonth() - 1);
      } else if (mode === 'nextmonth') {
        now.setMonth(now.getMonth() + 1);
      }
      cellIndex =
        1 -
        new Date(now.getFullYear(), now.getMonth(), 1).getDay() +
        startDayOffset;
      monthDays =
        32 - new Date(now.getFullYear(), now.getMonth(), 32).getDate();
      while (cellIndex > 1) {
        cellIndex -= 7;
      }
    }

    // Add column for week number
    if (self.config.showWeekNumber) {
      row.appendChild(
        el('th', {
          className: 'weeknum',
        })
      );
    }

    // Add columns for each day of week and populate with long name e.g. Sunday, Monday, ...
    for (var day = 0; day < 7; ++day) {
      const headerDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        cellIndex + day
      );
      row.appendChild(
        el('th', {
          className: 'header',
          innerHTML: headerDate.toLocaleString(config.language, {
            weekday: 'long',
          }),
        })
      );
    }
    table.appendChild(row);

    // For each week
    for (var week = 0; week < 6 && cellIndex <= monthDays; ++week) {
      row = el('tr', {
        className: 'xsmall',
      });
      if (self.config.showWeekNumber) {
        const weekDate = new Date(now.getFullYear(), now.getMonth(), cellIndex);
        row.appendChild(
          el('td', {
            className: 'weeknum',
            innerHTML: getWeekNumber(weekDate),
          })
        );
      }

      for (day = 0; day < 7; ++day, ++cellIndex) {
        var cellDate = new Date(now.getFullYear(), now.getMonth(), cellIndex);
        var cellDay = cellDate.getDate();

        // Create a cell and tag it
        cell = el('td', {
          className: 'cell',
        });
        if (['lastmonth', 'nextmonth'].includes(mode)) {
          // Do nothing
        } else if (cellIndex === today) {
          cell.classList.add('today');
        } else if (cellIndex !== cellDay && mode === 'currentmonth') {
          cell.classList.add('other-month');
        } else if (cellIndex < today) {
          cell.classList.add('past-date');
        }

        // Add 3 letter month to the top left cell and the 1st
        if ((week === 0 && day === 0) || cellDay === 1) {
          cellDay = cellDate.toLocaleString(config.language, {
            month: 'short',
            day: 'numeric',
          });
        }

        // Add cell to the row with the day number on top
        cell.appendChild(
          el('div', {
            innerHTML: cellDay,
          })
        );
        row.appendChild(cell);

        cellContents = el('div', {
          className: 'cell-contents',
        });
        cellContents.style.maxHeight =
          self.config.cellHeightPixels.toString() + 'px';
        cell.appendChild(cellContents);
        dateCells[cellIndex] = cellContents;
        eventsInCell[cellIndex] = 0;
        eventDivsForCell[cellIndex] = [];
      }

      table.appendChild(row);
    }

    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    var monthEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      monthDays,
      23,
      59,
      59
    );

    for (var i in self.events) {
      var e = self.events[i];

      for (
        var eventDate = e.startDate;
        eventDate <= e.endDate;
        eventDate = addOneDay(eventDate)
      ) {
        // Days from the start of the month
        var dayDiff = diffDays(eventDate, monthStart);

        // If the event day falls within our displayed days
        if (!(dayDiff in dateCells)) {
          continue;
        }

        let div = el('div', {
          className: 'event',
        });
        if (!self.config.wrapTitles) {
          div.classList.add('event-nowrap');
        }

        // Add time if not a full day event
        if (!e.fullDayEvent && self.config.displayTime) {
          function formatTime(d) {
            var h = d.getHours();
            var m = d.getMinutes().toString().padStart(2, '0');
            if (config.timeFormat === 12) {
              return (
                (h % 12 || 12) + (m > 0 ? `:${m}` : '') + (h < 12 ? 'am' : 'pm')
              );
            } else {
              return `${h}:${m}`;
            }
          }
          div.appendChild(
            el('span', {
              className: 'event-label',
              innerText: formatTime(e.startDate),
            })
          );
        }

        if (self.config.displaySymbol) {
          for (let symbol of e.symbol) {
            div.appendChild(
              el('span', {
                className: `event-label fa fa-${symbol}`,
              })
            );
          }
        }

        div.appendChild(
          el('span', {
            innerText: e.title,
          })
        );
        div.style.fontSize = self.config.fontSizePixels.toString() + 'px';

        if (e.color) {
          var c = e.color;

          if (e.fullDayEvent) {
            div.style.backgroundColor = c;
            if (
              getLuminance(div.style.backgroundColor) >=
              self.config.luminanceThreshold
            ) {
              div.style.color = 'black';
            }
          } else {
            div.style.color = c;
          }
        }

        eventDivsForCell[dayDiff].push(div);
      }
    }

    // Add events into cells
    for (day in dateCells) {
      let elipses = el('div', {
        className: 'event',
      });
      elipses.appendChild(
        el('span', {
          innerText: '   · · ·',
        })
      );
      elipses.style.fontWeight = 'bold';

      for (div in eventDivsForCell[day]) {
        if (++eventsInCell[day] < maxEvents) {
          dateCells[day].appendChild(eventDivsForCell[day][div]);
        } else {
          // If number of events matches max, show it. Otherwise show elipses
          if (eventDivsForCell[day].length === maxEvents) {
            dateCells[day].appendChild(eventDivsForCell[day][div]);
          } else {
            dateCells[day].appendChild(elipses);
            break;
          }
        }
      }
    }

    return moduleWrapper;
  },
});
