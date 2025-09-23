# Authify

Authify is a (mostly vibe-coded) Caido plugin for seamless Authorization testing of user roles.

## Features

You can also the "How to use" guide in the plugin's navigation bar or find a brief description of features below.

### Main functionality:
- Authify will automatically repeat requests, replacing headers with those provided in the Configuration
- The responses are compared and assigned "Same", "Simlar" or "Different" based on comparing the Status code and Response Length/Content (or Location Header for 3xx responses)
- Requests can also be viewed in the side menu with the option to switch between the Original and Modified request
- Automatic JSON prettification in Request/Response viewer
<img width="1917" height="995" alt="Screenshot 2025-09-23 235845" src="https://github.com/user-attachments/assets/d16f174d-7083-43c3-b26d-88c6bf6ceb88" />

### Additional functionality:
- Individual scope selection to filter what Requests are processed by Authify
- Choose to filter certain requests to reduce clutter (OPTIONS requests, styling, javascript and image files)
- "Send to Replay" sends the current request to a new Replay session
- Memory of selected scope and Config between Caido restarts
<img width="1917" height="973" alt="Screenshot 2025-09-23 235944" src="https://github.com/user-attachments/assets/330d0aa8-af86-4991-a518-125eed5e2a54" />


### Context Menu and Shortcuts:
- "Process with Authify" - select one or more request from anywhere in Caido to send it straight to Authify
- "Send headers to Authify" - update the Authify Config with one click on a request (useful for updating tokens after logout or token expiry)
- "Apply headers to Replay" - automatically replace headers in any Caido Request and send to a new Replay session
<img width="1732" height="395" alt="Screenshot 2025-09-24 000016" src="https://github.com/user-attachments/assets/dc8efe19-1531-4375-bb1d-4dbb8eb2cbdb" />

## Installation guide

- Download the .zip file from https://github.com/saltify7/Authify/releases
- Install to Caido https://docs.caido.io/guides/plugins_installing.html
