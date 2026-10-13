<div align="center">

<!-- ANIMATED HERO BANNER -->
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f172a,100:020617&height=250&section=header&text=AETHERDROP&fontSize=60&fontAlignY=35&animation=twinkling&fontColor=10b981&desc=The%20Short%20Way%20Home%20For%20Your%20Files&descSize=18&descAlignY=55&descColor=94a3b8" width="100%" alt="AetherDrop Hero Banner" />

<!-- LIVE TYPING ANIMATION -->
<a href="https://aetherdrop-pro.vercel.app/">
  <img src="https://readme-typing-svg.herokuapp.com?font=Inter&weight=600&size=22&pause=1000&color=38BDF8&center=true&vCenter=true&width=800&lines=A+Republic+for+Developers.;Zero+Cloud.+Maximum+Privacy.;Direct+Browser-to-Browser+P2P.;Connect+via+6-Digit+PIN.;Connect+via+Optical+QR+Scan." alt="Typing Animation" />
</a>

<br><br>

<!-- INTERACTIVE UI BUTTONS -->
<a href="https://aetherdrop-pro.vercel.app/" target="_blank">
  <img src="https://img.shields.io/badge/🚀_LAUNCH_LIVE_WORKSPACE-10B981?style=for-the-badge&logo=vercel&logoColor=white&labelColor=022C22" width="300" alt="Launch Workspace"/>
</a>
&nbsp;&nbsp;
<a href="https://projectsahibdeep.vercel.app/" target="_blank">
  <img src="https://img.shields.io/badge/⚡_MORE_PROJECTS-0F172A?style=for-the-badge&logo=react&logoColor=38BDF8&labelColor=020617" width="220" alt="More Projects"/>
</a>
&nbsp;&nbsp;
<a href="https://discord.gg/SCCWZaB3Sj" target="_blank">
  <img src="https://img.shields.io/badge/💬_JOIN_DISCORD-5865F2?style=for-the-badge&logo=discord&logoColor=white&labelColor=2B2D31" width="220" alt="Discord Community"/>
</a>

<br><br>

<!-- TECH STACK ICONS -->
<p align="center">
  <img src="https://skillicons.dev/icons?i=html,css,js,react,vercel,cloudflare,github" alt="Tech Stack" />
</p>

</div>

---

<br>

<h2 align="center">✦ A REPUBLIC FOR DEVELOPERS ✦</h2>

<p align="center">
  <em>Why route gigabytes across undersea fiber cables when the receiving screen is sitting 2 feet away?</em><br>
  AetherDrop discards the server entirely, building an encrypted, line-rate tunnel directly between your devices.
</p>

<br>

<!-- 2x2 UI FEATURE GRID -->
<table align="center" width="100%" style="border-collapse: collapse; border: none;">
  <tr>
    <td width="50%" align="center" valign="top" style="border: 1px solid #1E293B; padding: 20px; border-radius: 10px;">
      <img src="https://img.shields.io/badge/1-Direct_WebRTC_Pipeline-38BDF8?style=flat-square&logo=webrtc&logoColor=white" /><br><br>
      <b>Memory-to-Memory Transfers</b><br>
      Files stream directly via DTLS/SCTP encryption. Zero cloud custody. Not a single byte touches intermediate disk storage.
    </td>
    <td width="50%" align="center" valign="top" style="border: 1px solid #1E293B; padding: 20px; border-radius: 10px;">
      <img src="https://img.shields.io/badge/2-Optical_Vector_Handshake-10B981?style=flat-square&logo=minutemailer&logoColor=white" /><br><br>
      <b>Instant Camera Pairing</b><br>
      Dynamic SVG QR painter paired with an instant optical decoder. Point your camera, snap-lock the peers, and start dropping.
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top" style="border: 1px solid #1E293B; padding: 20px; border-radius: 10px;">
      <img src="https://img.shields.io/badge/3-Backpressure_Guardian-F59E0B?style=flat-square&logo=speedtest&logoColor=white" /><br><br>
      <b>64 KB Flow Control</b><br>
      Dynamic threshold polling prevents browser crashes during massive transfers by pacing memory buffers.
    </td>
    <td width="50%" align="center" valign="top" style="border: 1px solid #1E293B; padding: 20px; border-radius: 10px;">
      <img src="https://img.shields.io/badge/4-Cinematic_Stage-EC4899?style=flat-square&logo=youtube&logoColor=white" /><br><br>
      <b>Adaptive Media Viewport</b><br>
      Instantly mounts and auto-plays incoming video/audio streams the millisecond the binary packets reassemble in memory.
    </td>
  </tr>
</table>

<br>

---

<h2 align="center">🌌 THE FLIGHT PATH</h2>

<p align="center">
  AetherDrop utilizes a serverless signaling model. Once the initial handshake is brokered, the servers step out of the way, leaving a pure, encrypted peer-to-peer tunnel[cite: 1].
</p>

<div align="center">

```mermaid
flowchart LR
    subgraph Local Environment
        A[Local Node <br/> 🔑 PIN: 849201]
    end
    
    subgraph Remote Environment
        B[Remote Node <br/> 📷 Camera Scanner]
    end

    subgraph The Cloud
        C((Google STUN <br/> Broker Pool))
    end

    A -.->|1. Ephemeral Signaling Handshake| C
    B -.->|1. Ephemeral Signaling Handshake| C
    
    A <===>|2. WebRTC Direct Binary Stream <br/> 64 KB Slices • 0-Disk IO| B
    
    style A fill:#020617,stroke:#38BDF8,stroke-width:2px,color:#fff
    style B fill:#020617,stroke:#38BDF8,stroke-width:2px,color:#fff
    style C fill:#0F172A,stroke:#94A3B8,stroke-dasharray: 5 5,color:#fff
