# Preserved upstream licenses and notices

This folder contains copies of third-party license and notice texts. The
[project's third-party notices](../../THIRD_PARTY_NOTICES.md) explain which
components use them. The root [MIT license](../../LICENSE) covers the project's
original contributions.

| File | Scope |
| --- | --- |
| [ws-LICENSE.txt](ws-LICENSE.txt) | WebSocket transport used by the relay and gateway. |
| [port-LICENSE.txt](port-LICENSE.txt) and [port-NOTICE.md](port-NOTICE.md) | SledStormPSXRecomp components used by the optional recompiled engine. |
| [psxrecomp-LICENSE.txt](psxrecomp-LICENSE.txt) | Framework used by the optional recompiled engine. |
| [OpenBIOS-LICENSE.txt](OpenBIOS-LICENSE.txt) | OpenBIOS bundled by that framework. |

These upstream copies retain their original wording. In particular,
`port-NOTICE.md` describes its author's repository: references to “this
repository,” file paths, build commands and submodules there refer to that
upstream project. They are not setup instructions for Sled Storm Browser.
Use [our setup guide](../setup.md) to install and run this project.

EmulatorJS, PCSX-ReARMed, RetroArch and SDK notices are supplied with the pinned
source/asset distributions downloaded during setup. Their source pins and terms
are listed in [third-party notices](../../THIRD_PARTY_NOTICES.md).
