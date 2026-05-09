---
layout: default
title: Howard Family Genealogy Project
---

# Howard Family Genealogy Project

A personal, primary-source family history project tracing the ancestry of Brock Howard (Brooklyn, New York) across five immigrant-origin branches: Quebec (Dussault, Bousquet, Savaria, Choquet), Lebanon (Awad / Howayek of Hasroun), Scotland (Wilson of Glasgow and Perthshire), Northern Ireland (Greene and McMullen of County Londonderry), and colonial Connecticut (Smith and Lawrence).

## Goals

1. **Canadian Bill C-3 citizenship application.** Build a primary-source evidence chain from the applicant to a Quebec-born great-great-great-grandfather (Charles Dussault, baptized 9 January 1838 at Sainte-Anne-de-Varennes), using vital records, parish registers, and certified civil documents.
2. **Family history book.** Document each ancestral branch with full citations suitable for publication, prioritizing primary records over derivative trees.

## Current state

- Around 234 individuals validated across 9 generations on the Quebec line, 6 generations on the colonial Connecticut line, 4 generations on the Wilson Scottish line, and 3 generations on the maternal Compston / Coffman / Mercer line.
- Tree maintained in a private Gramps Web instance.
- Active correspondence with the Khayrallah Center for Lebanese Diaspora Studies at NC State, the St. Laba Hasroun Society in Michigan, the Mar Laba parish in Hasroun, the Toledo-Lucas County Public Library, and The Evergreens Cemetery in Brooklyn.

## Tooling

A suite of small, single-purpose command-line clients automates the read-side of structured genealogical web sources, all built on the same authenticated-session harness pattern:

| CLI | Source | Status |
|-----|--------|--------|
| cli-web-newspapers | Newspapers.com | working |
| cli-web-scotlandspeople | ScotlandsPeople | working |
| cli-web-genealogiequebec | Genealogie Quebec / Drouin | working |
| cli-web-findagrave | Find a Grave | working |
| cli-web-ancestry | Ancestry.com | built, awaiting auth |
| **cli-web-familysearch** | **FamilySearch** | **built, awaiting API access** |

## Why FamilySearch API access matters here

The FamilySearch CLI is the only one of the seven that requires registered API credentials rather than a session-cookie login. It is currently feature-complete in code but cannot run against the live tree until a developer key is issued. The use case is exclusively personal: pulling person, source, and relationship records for ancestors already identified in offline research, normalizing them, and merging into the private Gramps tree alongside the other six sources.

In return, primary-source citations developed during this project (Quebec parish acts, Scotland statutory births, Ireland Griffith's Valuation entries, US naturalization petitions, Find a Grave plot confirmations) are intended to be contributed back to FamilySearch as the offline research validates them, so the public tree benefits from the same documentation.

## Contact

Brock Howard — brockm.howard@gmail.com
