NAMED DATE RANGE MANAGEMENT FUNCTIONALITY
verify that nodejs-best-practices and rest-api-standards are loaded
update docs/schema.db to reflect the current situation if needed
verify your context still contains content from claude.md, api.md, frontend.md 
the other md under docs are not needed.

on BE (garmin-stats)
DB
Add a field in  date_ranges that point to activity. Activity can be pointed out by many date ranges.

ON FE / BE (garmin-dashboard)
Tab Data & Sync
Just above AI workout classification, put a card similar to sync strava activities for managing named date ranges
Date ranges are mainly intended to compare specific workout segment, e.g. training for boston marathon vs training for valencia marathon
or 2nd training week for boston marathon vs 3rd training week for boston marathon etc.
When saving a named date range, you can link a race that took place after the end of the named date range (not before). Race must be shown on a dropdown.
Give the possibility to delete a date range.
Think and plan before implement, steps are db, new api endpoint to serve new UI functionality, UI.
Follow the current project structure and put everything in the right place.

NAMED DATE RANGE MANAGEMENT FUNCTIONALITY - PART 2
- verify that nodejs-best-practices and rest-api-standards are loaded
- update docs/schema.db to reflect the current situation if needed
- verify your context still contains content from claude.md, api.md, frontend.md the other md under docs are not needed.
Data & Sync
**Named Date Ranges**
- let the current "save" row (the one with the two date pickers) fit the whole width, reserving more space for Name and dropdown. In case the drop down item take up more space then the available one, use ellipsis and a tooltip with the full name
- the first field, instead of being a simple text field, is a dropdown with the already saved name range, listed from newest to oldest. in case an already existing named date range is selected, the correspondat data are loaded, with save disabled. Save will be enabled in case at least one data of an existing named date range is changed, or a new named date range is set
**Overview & trends**
- Add a row, just below date range selection, that shows one "or" just below the first -> (current from-to date picker separator) and one "or" just below the second -> (compare to from-to date picker separator)
- Below the abovementioned row, add a row, with two drop down with the named date range, one that fit the width of the from to date pickers related to current, and one that fit the width of the from to date pickers related to compare to
- Compare to  named date range are selectable only if they end before the  start date selected in current.
- Named date range, if selected, take the precedence
- Obviously, named date range set the interval 
- First card, title must be SUMMARY - current date range vs compare to date range
- in case compare to is a named range and is linked to an activity (race), add this activity at the end (exactly as if we were in the activities tab)
- when scrolling, the first partm summary card, included, must stay on the screen.
Plan before implementing, present this plan to me, Stop and wait for my go before proceeding with the implementation
 
Some bugs to fix
we introduced date-fn, all the date pickers must be consistent, and all the reported date must follow the same date format. Currently os is set dd/mm/yyyy
Named date range

**Data & Sync**-> Named Date Ranges
Enlarge Create button to have the same width of update, so that the stacked field are of the same width (width of the one above matches the width of the one below)
Pick a saved range to edit must be a dropdown with the list of the saved named date range
Create a third row under Create Update to delete a named date range, and remove the list of the named date range
**Overview and trends**
