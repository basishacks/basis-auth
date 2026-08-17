---
layout: home

hero:
  name: "basis-auth"
  text: "Authentication for Basis applications"
  tagline: A focused OpenID Connect provider backed by Microsoft Entra ID and PostgreSQL.
  actions:
    - theme: brand
      text: View on GitHub
      link: https://github.com/basishacks/basis-auth
    - theme: alt
      text: Read the README
      link: https://github.com/basishacks/basis-auth/blob/main/README.md

features:
  - title: Microsoft Entra login
    details: Delegates human authentication to Microsoft Entra ID while keeping application sessions separate.
  - title: OAuth and OpenID Connect
    details: Provides a deliberately small authorization, token, UserInfo, JWKS, revocation, and logout surface.
  - title: PostgreSQL identity state
    details: Stores identities, permissions, clients, grants, sessions, authorization codes, and refresh-token state.
---
