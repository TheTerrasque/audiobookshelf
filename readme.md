<br />
<div align="center">
   <img alt="Audiobookshelf Banner" src="https://github.com/advplyr/audiobookshelf/raw/master/images/banner.svg" width="600">

  <p align="center">
    <br />
    <a href="https://audiobookshelf.org/docs">Documentation</a>
    ·
    <a href="https://audiobookshelf.org/support">Support</a>
    ·
    <a href="https://audiobooks.dev/">Demo</a>
  </p>
</div>

## ⚠️ Frontend pull requests are not being reviewed or merged for the existing Vue frontend. The frontend is currently being rewritten and migrated to React and should be available soon.

# About this fork

> [!NOTE]
> **This is an unofficial fork** of [advplyr/audiobookshelf](https://github.com/advplyr/audiobookshelf), focused on comic (CBZ/CBR) handling. It's not affiliated with or supported by the Audiobookshelf project. It is rebased on upstream regularly; currently v2.38.1 on top of upstream v2.38.0.
>
> **What's different** (branch `feat/comic-file-nav`):
>
> - **Server-side comic pages.** New endpoints `GET /api/items/:id/ebook/:fileid?/pages` (page list + ComicInfo.xml metadata) and `GET /api/items/:id/ebook/:fileid?/pages/:page` (a single page image). The web reader fetches pages one by one instead of downloading and unpacking the whole archive in the browser.
>   - Pages are cached in memory: an LRU cache sized in bytes (`COMIC_PAGE_CACHE_MAX_BYTES`, default 64 MB), plus a pool of open archives (`COMIC_EXTRACTOR_POOL_MAX`, default 4).
>   - CBZ files are streamed. CBR files are unpacked into a temp directory per archive, protected against zip-slip (entries escaping the directory).
> - **Comic reader improvements.** Fit modes (fit to screen, fit to width, custom zoom), background colour, mouse-wheel zoom, scroll to top on page change, and a redesigned top bar.
> - **Multi-file comics.** Books with several comic files can be read straight through: next/previous page crosses files, and a file list lets you jump between them.
>   - The order of the files can be changed (`PATCH /api/items/:id/ebook`).
>   - Reading progress remembers which file you were in (`mediaProgresses.ebookFileIno`, added by migration `v2.38.1`).
> - **Format filter** in the library view (audiobook / ebook / comic).
> - **Legacy fix.** Older records with an empty `ebookFormat` fall back to the file extension, so they still open as comics.
>
> The matching Android app fork, which reads comics through the same page API, is at [TheTerrasque/audiobookshelf-app](https://github.com/TheTerrasque/audiobookshelf-app).
>
> The database migration only adds a column, but this is still a one-way step: going back to official releases is untested.

# About

Audiobookshelf is a self-hosted audiobook and podcast server.

### Features

- Fully **open-source**, including the [android & iOS app](https://github.com/advplyr/audiobookshelf-app) _(in beta)_
- Stream all audio formats on the fly
- Search and add podcasts to download episodes w/ auto-download
- Multi-user support w/ custom permissions
- Keeps progress per user and syncs across devices
- Auto-detects library updates, no need to re-scan
- Upload books and podcasts w/ bulk upload drag and drop folders
- Backup your metadata + automated daily backups
- Progressive Web App (PWA)
- Chromecast support on the web app and android app
- Fetch metadata and cover art from several sources
- Chapter editor and chapter lookup (using [Audnexus API](https://audnex.us/))
- Merge your audio files into a single m4b
- Embed metadata and cover image into your audio files
- Basic ebook support and ereader
  - Epub, pdf, cbr, cbz
  - Send ebook to device (i.e. Kindle)
- Open RSS feeds for podcasts and audiobooks

Is there a feature you are looking for? [Suggest it](https://github.com/advplyr/audiobookshelf/issues/new/choose)

Join us on [Discord](https://discord.gg/HQgCbd6E75)

### Demo

Check out the web client demo: https://audiobooks.dev/ (thanks for hosting [@Vito0912](https://github.com/Vito0912)!)

Username/password: `demo`/`demo` (user account)

### Android App (beta)

Try it out on the [Google Play Store](https://play.google.com/store/apps/details?id=com.audiobookshelf.app)

### iOS App (beta)

**Beta is currently full. Apple has a hard limit of 10k beta testers. Updates will be posted in Discord.**

Using Test Flight: https://testflight.apple.com/join/wiic7QIW **_(beta is full)_**

<br />

<img alt="Library Screenshot" src="https://github.com/advplyr/audiobookshelf/raw/master/images/DemoLibrary.png" />

<br />

# Organizing your media

#### Directory structure and folder names are important to Audiobookshelf!

See [library docs](https://audiobookshelf.org/docs/category/libraries) for supported directory structures, folder naming conventions, and audio file metadata usage.

<br />

# Installation

See [install docs](https://audiobookshelf.org/docs/category/installation)

<br />

# Reverse Proxy Set Up

#### Important! Audiobookshelf requires a websocket connection.

#### Note: Using a subfolder is supported with no additional changes but the path must be `/audiobookshelf` (this is not changeable). See [discussion](https://github.com/advplyr/audiobookshelf/discussions/3535)

See [reverse proxy docs](https://audiobookshelf.org/docs/category/reverse-proxy)

<br />

# Contributing

See [contributing docs](https://audiobookshelf.org/docs/contributing/general/)

### Localization

Thank you to [Weblate](https://hosted.weblate.org/engage/audiobookshelf/) for hosting our localization infrastructure pro-bono. If you want to see Audiobookshelf in your language, please help us localize. Additional information on helping with the translations [here](https://www.audiobookshelf.org/faq#how-do-i-help-with-translations). <a href="https://hosted.weblate.org/engage/audiobookshelf/"> <img src="https://hosted.weblate.org/widget/audiobookshelf/abs-web-client/multi-auto.svg" alt="Translation status" /> </a>

<br />

# Run from source

This application is built using [NodeJs](https://nodejs.org/).

### Dev Container Setup

The easiest way to begin developing this project is to use a dev container. An introduction to dev containers in VSCode can be found [here](https://code.visualstudio.com/docs/devcontainers/containers).

Required Software:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [VSCode](https://code.visualstudio.com/download)

_Note, it is possible to use other container software than Docker and IDEs other than VSCode. However, this setup is more complicated and not covered here._

<div>
<details>
<summary>Install the required software on Windows with <a href=(https://docs.microsoft.com/en-us/windows/package-manager/winget/#production-recommended)>winget</a></summary>

<p>
Note: This requires a PowerShell prompt with winget installed.  You should be able to copy and paste the code block to install.  If you use an elevated PowerShell prompt, UAC will not pop up during the installs.

```PowerShell
winget install -e --id Docker.DockerDesktop; `
winget install -e --id Microsoft.VisualStudioCode
```

</p>
</details>
</div>

<div>
<details>
<summary>Install the required software on MacOS with <a href=(https://snapcraft.io/)>homebrew</a></summary>

<p>

```sh
brew install --cask docker visual-studio-code
```

</p>
</details>
</div>

<div style="padding-bottom: 1em">
<details>
<summary>Install the required software on Linux with <a href=(https://brew.sh/)>snap</a></summary>

<p>

```sh
sudo snap install docker; \
sudo snap install code --classic
```

</p>
</details>
</div>

After installing these packages, you can now install the [Remote Development](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack) extension for VSCode. After installing this extension open the command pallet (`ctrl+shift+p` or `cmd+shift+p`) and select the command `>Dev Containers: Rebuild and Reopen in Container`. This will cause the development environment container to be built and launched.

You are now ready to start development!

### Manual Environment Setup

If you don't want to use the dev container, you can still develop this project. First, you will need to install [NodeJs](https://nodejs.org/) (version 24) and [FFmpeg](https://ffmpeg.org/).

Next you will need to create a `dev.js` file in the project's root directory. This contains configuration information and paths unique to your development environment. You can find an example of this file in `.devcontainer/dev.js`.

You are now ready to build the client:

```sh
npm ci
cd client
npm ci
npm run generate
cd ..
```

### Development Commands

After setting up your development environment, either using the dev container or using your own custom environment, the following commands will help you run the server and client.

To run the server, you can use the command `npm run dev`. This will compile the server and use the client that was built when you ran `npm run generate` in the client directory or when you started the dev container. Server changes are compiled and restarted automatically. If you make changes to the client, you will need to run the command `(cd client; npm run generate)` and then restart the server. By default the client runs at `localhost:3333`, though the port can be configured in `dev.js`.

You can also build a version of the client that supports live reloading. To do this, start the server, then run the command `(cd client; npm run dev)`. This will run a separate instance of the client at `localhost:3000` that will be automatically updated as you make changes to the client.

If you are using VSCode, this project includes a couple of pre-defined targets to speed up this process. First, if you build the project (`ctrl+shift+b` or `cmd+shift+b`) it will automatically generate the client. Next, there are debug commands for running the server and client. You can view these targets using the debug panel (bring it up with (`ctrl+shift+d` or `cmd+shift+d`):

- `Debug server`—Run the server.
- `Debug client (nuxt)`—Run the client with live reload.
- `Debug server and client (nuxt)`—Runs both the preceding two debug targets.
