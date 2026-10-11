# KINO-XII
Front side of a cinema booking web app. Plain HTML, CSS and JavaScript (ES modules), built for a 1920×1080 desktop viewport.

Live: https://nikadavita.github.io/KINO-XII-RDBR/

## Running locally
The scripts are ES modules, so the page has to be served over `http://`. Opening `index.html` by double-clicking it (`file://`) will not work.

Either:
- VS Code: install the **Live Server** extension, right-click `index.html` → *Open with Live Server*, or
- Terminal: `python -m http.server 5500`, then open http://127.0.0.1:5500

## Structure
```
index.html          Home page
sessions.html       Sessions: filters + showtimes, all state in the URL
profile.html        My Profile: personal info form + My Tickets (?tab=tickets&list=past)
movie.html          Film details: ?slug=…&date=…&session=… (session opens the booking modal)
css/styles.css      Shared: colour tokens, buttons, badges, header, footer, modal
css/home.css        Home page: hero carousel, card rows
css/sessions.css    Sessions page
css/movie.css       Film details page
css/booking.css     Booking modal
css/profile.css     My Profile page
js/api.js           All API calls + token storage
js/auth.js          Session restore (/me), login/logout, withAuth() for protected actions
js/header.js        Shared header + footer markup, search, guest buttons / user menu
js/auth-modal.js    Log in / Sign up modal with field validation
js/recent.js        "Recently viewed" (stored in localStorage, the API has no endpoint)
js/home.js          Home page logic
js/sessions.js      Sessions page: URL <-> filter state, list, pagination
js/movie.js         Film details page
js/profile.js       My Profile: validation, save, tickets, refunds
js/booking.js       Booking modal: seat map -> hold -> checkout -> order -> confirmation
API docs https://api.kinoxii.redberryinternship.ge/docs