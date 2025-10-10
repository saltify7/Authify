## UI
- compare responses widget (diff) with synced scrolling
- HTTPQL config for filtering requests
- colour-code methods in table?

## LOGIC
- drop requests (if possible to intercept, resend and drop)
- automatic cookie and auth header extraction from modified responses
- hotkey for switching between original and modified
- make session storage per-project rather than global (integrate with project change)
- modify "Apply headers to replay" to replace headers directly in session rather than making a new one

## PERFORMANCE
- allow table limit to be customised (set to 500 rows for now)

## BUGS
- send to replay - keep HTTP/HTTPS (defaults to https for now)