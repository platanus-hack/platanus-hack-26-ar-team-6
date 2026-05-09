desktop app run instructions

install and run:

```sh
cd /Users/maria/IdeaProjects/platanus-hack-26-ar-team-6/apps/desktop
npm install
npm run dev
```

environment:

```env
VITE_API_BASE_URL=https://creative-possibility-production-f2af.up.railway.app
```

to install:

```
brew install --cask xquartz
open -a XQuartz
export DISPLAY=:0    
/opt/X11/bin/xhost +localhost
```

docker:

```shell
docker run --rm -e DISPLAY=host.docker.internal: relevo-desktop   
```