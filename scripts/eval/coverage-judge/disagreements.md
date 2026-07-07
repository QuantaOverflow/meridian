# 覆盖对账判官 — 共同标注分歧清单（人裁）

三尺：det(决定论对齐) / judge(qwen-long 被验) / codex(GPT 第二标注)
共 112 story：一致 77，需裁 35

裁定方法：读 label + 简报候选块，判该 story 在简报里的真实去向 {headline|noteworthy|dropped}。
把裁定写进 gold.jsonl，每行 {"id":"...","gold":"dropped"}（provisional-gold.jsonl 是一致项，可直接并入）。

> 决策级看点：**covered↔dropped 的分歧**（影响"合成漏报"计数）优先裁；headline↔noteworthy 分歧影响小。


---
### admin-brief-1782370673032#S3  (仅 headline↔noteworthy)
cluster 2 · **det**=headline · **judge**=headline · **codex**=noteworthy
label: Israel has captured the historic Beaufort Castle in southern Lebanon, marking its deepest incursion since 2000 and signaling a dramatic escalation despite a US-
对齐器命中块（锚 [beaufort, castle, lebanon, incursion, signaling, escalation] score=9.50）:
  …<u>**the ceasefire that isn’t: US-Iran hostilities escalate *while* diplomacy proceeds in parallel**</u>   On June 1, 2026, the US and Iran exchanged retaliatory strikes—CENTCOM hit Iranian radar and drone command sites in **Goruk** and on **Qeshm Island**, while the **IRGC struck a US-operated airbase in Kuwait**, prompting nationwide missile and drone intercepts. This marks the *third major viol…

---
### admin-brief-1782370673032#S4  (仅 headline↔noteworthy)
cluster 11 · **det**=headline · **judge**=noteworthy · **codex**=noteworthy
label: The Democratic Republic of Congo is experiencing its 17th Ebola outbreak, driven by the Bundibugyo virus species — for which no approved vaccines or therapeutic
对齐器命中块（锚 [ebola, outbreak, bundibugyo, virus, approved] score=12.00）:
  …<u>**Kenya’s Ebola quarantine standoff reveals the crumbling facade of ‘global health equity’**</u>   Hundreds of Kenyans protested in **Nanyuki** on June 1 against a US-funded, military-based Ebola quarantine facility at **Laikipia Air Base**, intended for asymptomatic US citizens exposed abroad. Despite US officials stating the **50-bed facility** was set to open May 29 and that **$13.5 million*…

---
### admin-brief-1782370673032#S9  ⚠️ 决策级(covered↔dropped)
cluster 5 · **det**=headline · **judge**=dropped · **codex**=dropped
label: The Trump administration has effectively paused its $1.8 billion 'anti-weaponisation fund'—established as part of a settlement in Trump's lawsuit against the IR
对齐器命中块（锚 [trump, administration, effectively, anti] score=3.17）:
  …<u>**Colombia’s runoff isn’t just an election—it’s the first live stress test of the transnational far-right axis**</u>   In Colombia’s 2026 presidential first round, far-right outsider **Abelardo de la Espriella** won **43.7%**, narrowly edging out leftist **Iván Cepeda** (**40.9%**) and setting up a June 21 runoff. His victory wasn’t just anti-Petro—it was *post-conservative*: he explicitly mode…

---
### admin-brief-1782322639966#S4  (仅 headline↔noteworthy)
cluster 3 · **det**=headline · **judge**=noteworthy · **codex**=noteworthy
label: Defence Secretary John Healey resigned on 2026-06-11 after rejecting a Treasury settlement that left an £18bn shortfall in the Defence Investment Plan (DIP), of
对齐器命中块（锚 [defence, healey, 18bn, shortfall] score=6.50）:
  …<u>**UK seizes Russia’s shadow fleet tanker — and rewrites the rules of sanctions enforcement**</u>  In a six-hour operation in the English Channel, Royal Marines and NCA officers boarded and seized the Cameroonian-flagged oil tanker *Smyrtos*, marking the first-ever sovereign UK interdiction of a vessel tied to Russia’s sanctions-evading “shadow fleet”. This isn’t just another port ban — it’s kin…

---
### admin-brief-1782322639966#S7  ⚠️ 决策级(covered↔dropped)
cluster 13 · **det**=dropped · **judge**=noteworthy · **codex**=noteworthy
label: Two helicopters collided mid-air over Recreio dos Bandeirantes, a western suburb of Rio de Janeiro, on Sunday, June 14, 2026, killing all six people on board. V
对齐器：无专有名词命中任何简报块（→ 判 dropped）

---
### admin-brief-1782322639966#S8  ⚠️ 决策级(covered↔dropped)
cluster 11 · **det**=headline · **judge**=dropped · **codex**=dropped
label: On 14 June 2026, Israeli airstrikes killed four Palestinians near the Jabalia refugee camp in northern Gaza and two others in southern Gaza, according to Palest
对齐器命中块（锚 [israeli, near, palest] score=2.67）:
  …<u>**London’s Edgware protests — where international law meets residential anxiety**</u>  Outside Edgware United Synagogue, ~1,000 people gathered for rival protests over the “Great Israeli Real Estate Event”, resulting in 14–15 arrests. But the significance isn’t the crowd size — it’s the operational doctrine deployed by the Metropolitan Police. Commander Adam Slonecki publicly justified differen…

---
### admin-brief-1782322639966#S12  ⚠️ 决策级(covered↔dropped)
cluster 10 · **det**=headline · **judge**=dropped · **codex**=dropped
label: A Pacific Aerospace P750 aircraft crashed shortly after takeoff from Butler Memorial Airport in Bates County, Missouri, on Sunday, June 14, 2026, killing all 12
对齐器命中块（锚 [bates] score=3.00）:
  …### economic currents  The US-Iran MoU’s potential reopening of the Strait of Hormuz — through which 20% of the world’s oil and LNG flows — represents the single largest near-term upside for global energy markets. Yet its fragility is baked in: no enforcement mechanism, no clarity on frozen assets, and active sabotage by a key US ally. Meanwhile, Switzerland’s rejection of the population cap prese…

---
### admin-brief-1782322639966#S13  ⚠️ 决策级(covered↔dropped)
cluster 6 · **det**=headline · **judge**=dropped · **codex**=dropped
label: In their opening match of the 2026 FIFA World Cup, the Netherlands and Japan played out a dramatic 2–2 draw at AT&T Stadium in Dallas, Texas, with Japan twice c
对齐器命中块（锚 [world, draw, stadium] score=6.50）:
  …<u>**Morocco’s draw with Brazil — the quiet dismantling of football’s hierarchy**</u>  Morocco’s 1–1 draw with Brazil in New York wasn’t just a result — it was a tectonic readjustment. Ismael Saibari’s 21st-minute goal exposed defensive vulnerabilities in Carlo Ancelotti’s side, while Vinicius Junior’s spectacular solo equalizer couldn’t mask Casemiro’s first-half substitution or Brazil’s lack of …

---
### admin-brief-1782204768600#S4  (仅 headline↔noteworthy)
cluster 3 · **det**=headline · **judge**=noteworthy · **codex**=headline
label: On Day 116 of the 'US-Israel war on Iran', the US and Iran have implemented a 60-day memorandum of understanding involving temporary easing of oil and petrochem
对齐器命中块（锚 [iran, temporary, petrochem] score=3.30）:
  …<u>**Iran’s ‘administration’ of the Strait of Hormuz is a sovereignty bluff—with real teeth**</u>   Iran has declared it will “administer” the **Strait of Hormuz**, following US-Iran talks in Switzerland—a phrase so legally ambiguous it functions as both diplomatic shield and coercive spear. What’s concrete? A **60-day MoU**, effective until **August 21**, suspending hostilities and temporarily li…

---
### admin-brief-1782204768600#S7  ⚠️ 决策级(covered↔dropped)
cluster 12 · **det**=headline · **judge**=dropped · **codex**=dropped
label: A deadly fire in a three-storey commercial building in Lucknow's Aliganj area killed at least 15 people—primarily young trainees and employees at an animation a
对齐器命中块（锚 [fire, lucknow] score=3.50）:
  …## tech & science developments   **no actual breakthroughs reported in the curated data**   There are no clusters covering AI/LLMs, biomed, space, or scientific breakthroughs. Mentions of technology are limited to biometric access controls in the Lucknow fire (a failure mode, not an advance) and generic references to digital infrastructure in heatwave disruptions. No LLM releases, AI policy shifts…

---
### admin-brief-1782204768600#S9  ⚠️ 决策级(covered↔dropped)
cluster 8 · **det**=headline · **judge**=dropped · **codex**=dropped
label: On June 22, 2026, two male students—aged 14 and 15—opened fire with a .38 revolver and a 9mm pistol at San Jose National High School in Tacloban City, Philippin
对齐器命中块（锚 [national, high, school] score=4.20）:
  …<u>**Western Europe’s June heatwave isn’t weather—it’s infrastructure failure, live and in color**</u>   A climate-intensified heatwave shattered records across Western Europe in late June 2026: **Paris hit 38.4°C—the highest June temperature on record**; the UK issued rare **red weather warnings** forecasting **38–40°C**, and **at least 18 heat-related deaths** were confirmed in France—including …

---
### admin-brief-1782204768600#S11  (仅 headline↔noteworthy)
cluster 2 · **det**=headline · **judge**=noteworthy · **codex**=noteworthy
label: Ten years after the 2016 Brexit referendum, the UK remains politically fractured, economically strained, and socially polarized, with Brexit functioning as a pe
对齐器命中块（锚 [years, 2016, brexit, referendum] score=8.50）:
  …<u>**Starmer’s resignation isn’t a collapse—it’s the final symptom of Brexit’s metastatic failure**</u>   Keir Starmer resigned as UK Prime Minister on **June 22, 2026**, after less than two years in office—becoming the *seventh* PM in ten years. His departure wasn’t triggered by scandal alone, but by the cumulative weight of a political system hollowed out by the 2016 referendum: sluggish growth,…

---
### admin-brief-1781007434068#S7  (仅 headline↔noteworthy)
cluster 11 · **det**=headline · **judge**=noteworthy · **codex**=noteworthy
label: U.S. District Judge Leo Sorokin in Boston struck down the Trump administration's $100,000 fee on new H-1B visa petitions, ruling it an unconstitutional tax impo
对齐器命中块（锚 [district, judge, sorokin, struck, down, trump, administration, visa, ruling, unconstitutional, impo] score=15.33）:
  …<u>**The DOJ is no longer a law enforcement agency — it’s Trump’s personal litigation arm**</u>   Donald Trump’s nomination of **Todd Blanche**, his former personal lawyer and current Acting Attorney General, to serve permanently as U.S. Attorney General crystallizes a systemic rupture in American governance. Under Blanche, the DOJ has pursued actions widely interpreted as politically weaponized: …

---
### admin-brief-1781007434068#S11  (仅 headline↔noteworthy)
cluster 18 · **det**=headline · **judge**=noteworthy · **codex**=noteworthy
label: Global nuclear weapons spending reached a record $119 billion in 2025, driven by unprecedented U.S. investment ($69.2bn) and rapid modernisation across all nine
对齐器命中块（锚 [global, nuclear, spending, reached, record, billion] score=4.71）:
  …<u>**Global conflict just hit a WWII-level inflection point — and nobody’s sounding the alarm loud enough**</u>   The **Uppsala Conflict Data Program (UCDP)**’s 2025 dataset confirms a historic peak: **65 active conflicts**, the highest since WWII — including **eight interstate wars** (Russia-Ukraine, Iran-Israel, U.S./U.K.-Houthis, etc.). Battle-related fatalities reached **244,600**, the highest…

---
### admin-brief-1781007434068#S13  ⚠️ 决策级(covered↔dropped)
cluster 3 · **det**=headline · **judge**=dropped · **codex**=dropped
label: Multiple survivor testimonies and UN, ICC, and Israeli human rights group reports document the widespread, systematic use of rape, sexual torture, and dehumaniz
对齐器命中块（锚 [multiple, israeli, human, systematic] score=7.00）:
  …<u>**Lebanon isn’t in a ceasefire — it’s in an occupation masked as diplomacy**</u>   Israel’s “second military intensification” against Lebanon, launched March 2, 2026, has metastasized into a *de facto mechanized occupation* of **~2,000 sq km in southern Lebanon**, with senior officials openly stating intent to hold territory up to the **Litani River** — and some advocating annexation. Multiple …

---
### admin-brief-1781007434068#S14  (仅 headline↔noteworthy)
cluster 6 · **det**=headline · **judge**=headline · **codex**=noteworthy
label: Omar Abdulkadir Artan, Somalia’s top referee and the first Somali selected to officiate at the FIFA World Cup, was denied entry to the United States at Miami In
对齐器命中块（锚 [omar, artan, somalia, referee, somali, selected, fifa, world, denied, miami] score=35.25）:
  …<u>**The World Cup has become a live stress test of U.S. sovereignty claims — and it’s failing**</u>   The 2026 FIFA World Cup — co-hosted by the **U.S., Canada, and Mexico** — is unfolding amid active warfare between the host nation and a participating team. **Iran’s football federation (FFIRI)** had its official **8% allocation of fan tickets** revoked for all three U.S.-hosted matches, and its …

---
### admin-brief-1781007434068#S15  (仅 headline↔noteworthy)
cluster 19 · **det**=headline · **judge**=noteworthy · **codex**=noteworthy
label: Kenyan police deployed tear gas to disperse protests in Nanyuki against a US-built 50-bed Ebola quarantine centre for asymptomatic American citizens, amid activ
对齐器命中块（锚 [kenyan, tear, protests, ebola, quarantine, american, activ] score=7.25）:
  …<u>**Global conflict just hit a WWII-level inflection point — and nobody’s sounding the alarm loud enough**</u>   The **Uppsala Conflict Data Program (UCDP)**’s 2025 dataset confirms a historic peak: **65 active conflicts**, the highest since WWII — including **eight interstate wars** (Russia-Ukraine, Iran-Israel, U.S./U.K.-Houthis, etc.). Battle-related fatalities reached **244,600**, the highest…

---
### admin-brief-1780662961660#S10  (仅 headline↔noteworthy)
cluster 8 · **det**=headline · **judge**=noteworthy · **codex**=noteworthy
label: Two competing legislative initiatives are exposing a deep and accelerating rupture in U.S. congressional consensus on Israel: the NDAA's Section 224, which woul
对齐器命中块（锚 [deep, israel, ndaa, section, woul] score=13.70）:
  …<u>**The Israel-Lebanon ceasefire collapsed before it began—because it was never meant to hold**</u>   The June 4 U.S.-brokered “ceasefire” between Israel and Lebanon wasn’t a diplomatic breakthrough—it was a performative fiction exposed within hours. Hezbollah’s Naim Qassem called it a “surrender,” Israeli Defence Minister Israel Katz declared operations would “continue… on the ground,” and Leban…

---
### admin-brief-1780662961660#S11  ⚠️ 决策级(covered↔dropped)
cluster 10 · **det**=headline · **judge**=dropped · **codex**=dropped
label: Former National Security Advisor John Bolton has agreed to plead guilty to one count of illegal retention of national defense information, avoiding trial in a h
对齐器命中块（锚 [security, defense] score=2.00）:
  …### china monitor   Xi’s imminent Pyongyang visit is the central China-related development—and it reveals a decisive, pragmatic recalibration. Beijing’s public denuclearization rhetoric has “noticeably softened,” per the data, signaling a shift from pressure to *stability management*. This isn’t acquiescence—it’s recognition that Kim’s nuclear acceleration serves multiple purposes: extracting econ…

---
### admin-brief-1780662961660#S12  ⚠️ 决策级(covered↔dropped)
cluster 12 · **det**=headline · **judge**=noteworthy · **codex**=dropped
label: Senate Republicans narrowly passed a $70 billion immigration enforcement funding bill using budget reconciliation after an 18-hour vote-a-rama, during which Dem
对齐器命中块（锚 [senate, republicans, vote] score=4.67）:
  …<u>**Trump’s war powers crisis isn’t about Iran—it’s about the erosion of constitutional guardrails**</u>   The U.S. House passing a war powers resolution 215–208 to compel withdrawal from hostilities with Iran wasn’t symbolic—it was the first chamber-level action of its kind since Operation Epic Fury began on February 28, 2026. Four Republicans broke ranks—Thomas Massie (constitutionalist), Warre…

---
### admin-brief-1780662961660#S13  ⚠️ 决策级(covered↔dropped)
cluster 15 · **det**=headline · **judge**=dropped · **codex**=dropped
label: The Trump administration has escalated its interventionist posture in Latin America through the Americas Counter Cartel Coalition (A3C), backing Bolivian Presid
对齐器命中块（锚 [trump, administration, presid] score=4.00）:
  …<u>**Trump’s war powers crisis isn’t about Iran—it’s about the erosion of constitutional guardrails**</u>   The U.S. House passing a war powers resolution 215–208 to compel withdrawal from hostilities with Iran wasn’t symbolic—it was the first chamber-level action of its kind since Operation Epic Fury began on February 28, 2026. Four Republicans broke ranks—Thomas Massie (constitutionalist), Warre…

---
### admin-brief-1780662961660#S14  ⚠️ 决策级(covered↔dropped)
cluster 6 · **det**=headline · **judge**=dropped · **codex**=dropped
label: Andy Burnham has publicly declared his conditional intent to challenge Keir Starmer for the Labour leadership if elected in the Makerfield byelection, prompting
对齐器命中块（锚 [keir, starmer] score=6.00）:
  …<u>**The Henry Nowak murder crisis isn’t about policing—it’s about the weaponization of narrative in liberal democracies**</u>   The December 2025 stabbing of 18-year-old Henry Nowak in Southampton ignited something far larger than a criminal investigation: a transatlantic crisis of democratic legitimacy. Hampshire Police handcuffed Nowak while he was dying and pleading he couldn’t breathe; three …

---
### admin-brief-1780554095183#S8  ⚠️ 决策级(covered↔dropped)
cluster 9 · **det**=headline · **judge**=dropped · **codex**=dropped
label: A 12-hour hostage standoff at a multistory building housing a Chase Bank branch and school district office in Bakersfield, California, concluded on Wednesday, J
对齐器命中块（锚 [california] score=4.50）:
  …<u>**California’s Jungle Primary: A Republican Governor in America’s Largest Economy?**</u>   In California’s June 3, 2026 jungle primary, **Steve Hilton (R)** edged out **Xavier Becerra (D)** — **26.9% to 25.7%** — setting up a November general election where the last Republican governor served over **15 years ago**. The race unfolded against national headwinds: the **US-Iran war** driving fuel p…

---
### admin-brief-1780554095183#S12  ⚠️ 决策级(covered↔dropped)
cluster 13 · **det**=headline · **judge**=dropped · **codex**=dropped
label: CBS News has undergone a rapid, top-down leadership purge culminating in the June 3, 2026 firing of veteran 60 Minutes correspondent Scott Pelley after a public
对齐器命中块（锚 [news, public] score=3.75）:
  …<u>**California’s Jungle Primary: A Republican Governor in America’s Largest Economy?**</u>   In California’s June 3, 2026 jungle primary, **Steve Hilton (R)** edged out **Xavier Becerra (D)** — **26.9% to 25.7%** — setting up a November general election where the last Republican governor served over **15 years ago**. The race unfolded against national headwinds: the **US-Iran war** driving fuel p…

---
### admin-brief-1780554095183#S13  (仅 headline↔noteworthy)
cluster 6 · **det**=headline · **judge**=noteworthy · **codex**=noteworthy
label: In a significant blow to Donald Trump's political influence, his endorsed candidate Randy Feenstra lost Iowa's Republican gubernatorial primary to Zach Lahn—a p
对齐器命中块（锚 [trump, influence, randy, feenstra, iowa, republican, primary] score=17.25）:
  …<u>**California’s Jungle Primary: A Republican Governor in America’s Largest Economy?**</u>   In California’s June 3, 2026 jungle primary, **Steve Hilton (R)** edged out **Xavier Becerra (D)** — **26.9% to 25.7%** — setting up a November general election where the last Republican governor served over **15 years ago**. The race unfolded against national headwinds: the **US-Iran war** driving fuel p…

---
### admin-brief-1780494276570#S2  (仅 headline↔noteworthy)
cluster 2 · **det**=headline · **judge**=headline · **codex**=noteworthy
label: Despite US President Donald Trump’s public announcement of a de-escalation agreement between Israel and Hezbollah—wherein Israel would halt strikes on Beirut’s 
对齐器命中块（锚 [trump, public, escalation, agreement, israel, hezbollah, halt, strikes, beirut] score=13.03）:
  …<u>**The Strait of Hormuz is no longer a chokepoint—it’s a detonator**</u>   What happened is stark: on June 3, the US struck an Iranian oil tanker near the Strait of Hormuz—then followed with “self-defense” strikes on **Qeshm Island**, targeting an IRGC ground control station and a telecommunications tower. Iran retaliated with drone and missile barrages against **Kuwait International Airport** (…

---
### admin-brief-1780494276570#S3  (仅 headline↔noteworthy)
cluster 17 · **det**=headline · **judge**=headline · **codex**=noteworthy
label: Russia launched an unprecedented overnight aerial barrage on Ukraine on 1–2 June 2026, deploying 656 drones and 73 missiles across at least six regions—includin
对齐器命中块（锚 [russia, overnight, barrage, ukraine, drones, missiles, least] score=24.50）:
  …<u>**Ukraine just bombed Putin’s Davos—and did it with precision, timing, and narrative discipline**</u>   In a single overnight operation on June 2–3, Ukrainian long-range drones struck the **St. Petersburg oil terminal**, the historic **Kronstadt naval base**, and a weapons factory in **Tambov**—all over **1,000 km** from Ukraine’s border. The strikes caused visible black smoke over St. Petersbu…

---
### admin-brief-1780494276570#S4  (仅 headline↔noteworthy)
cluster 3 · **det**=headline · **judge**=headline · **codex**=noteworthy
label: Iran has suspended all indirect negotiations with the United States, citing Israel's expanding military operations in southern Lebanon—including forced displace
对齐器命中块（锚 [iran, indirect, states, israel, operations, southern, lebanon, including] score=15.75）:
  …<u>**The Strait of Hormuz is no longer a chokepoint—it’s a detonator**</u>   What happened is stark: on June 3, the US struck an Iranian oil tanker near the Strait of Hormuz—then followed with “self-defense” strikes on **Qeshm Island**, targeting an IRGC ground control station and a telecommunications tower. Iran retaliated with drone and missile barrages against **Kuwait International Airport** (…

---
### admin-brief-1780494276570#S9  ⚠️ 决策级(covered↔dropped)
cluster 20 · **det**=headline · **judge**=dropped · **codex**=dropped
label: As the 2026 FIFA World Cup commences, host cities face acute tensions between mega-event security imperatives and domestic socio-political unrest. In Los Angele
对齐器命中块（锚 [world, security] score=1.83）:
  …<u>**California’s governor race is a stress test for American democracy—and it’s too close to call**</u>   In California’s jungle primary, **Steve Hilton** (Republican, Trump-endorsed) led with **26.9%**, **Xavier Becerra** (Democrat, former HHS Secretary) trailed by ~49,000 votes at **25.7%**, and billionaire Democrat **Tom Steyer** sat third at **19.8%**, with results still pending from mail-in …

---
### admin-brief-1780494276570#S13  ⚠️ 决策级(covered↔dropped)
cluster 29 · **det**=dropped · **judge**=headline · **codex**=headline
label: The EU has provisionally agreed on a sweeping new returns regulation that significantly expands coercive immigration enforcement tools—including home raids, det
对齐器：无专有名词命中任何简报块（→ 判 dropped）

---
### admin-brief-1780494276570#S14  (仅 headline↔noteworthy)
cluster 30 · **det**=headline · **judge**=headline · **codex**=noteworthy
label: The Permanent Court of Arbitration in The Hague has unanimously rejected Rwanda’s $134 million (£100 million) financial claim against the UK arising from the 20
对齐器命中块（锚 [permanent, court, arbitration, rejected, rwanda, million, financial, claim] score=20.25）:
  …<u>**The EU just codified ICE-style enforcement—and outsourced it to Africa**</u>   The EU has provisionally agreed on a sweeping new **Returns Regulation**, authorizing **home raids**, detention of up to **30 months** (including for unaccompanied minors), **lifetime entry bans**, benefit sanctions, and crucially, the establishment of offshore **“return hubs” in third countries—primarily in Africa…

---
### admin-brief-1780494276570#S15  ⚠️ 决策级(covered↔dropped)
cluster 31 · **det**=headline · **judge**=dropped · **codex**=dropped
label: The Trump administration formally abandoned its $1.776 billion 'anti-weaponization fund' on June 2, 2026, after just two weeks, following intense bipartisan pol
对齐器命中块（锚 [trump, billion] score=2.50）:
  …<u>**California’s governor race is a stress test for American democracy—and it’s too close to call**</u>   In California’s jungle primary, **Steve Hilton** (Republican, Trump-endorsed) led with **26.9%**, **Xavier Becerra** (Democrat, former HHS Secretary) trailed by ~49,000 votes at **25.7%**, and billionaire Democrat **Tom Steyer** sat third at **19.8%**, with results still pending from mail-in …

---
### admin-brief-1780036335731#S7  ⚠️ 决策级(covered↔dropped)
cluster 10 · **det**=headline · **judge**=noteworthy · **codex**=dropped
label: Lebanon — Israeli strikes escalate in southern and eastern Lebanon, including Tyre and Beirut
对齐器命中块（锚 [israeli, including] score=3.50）:
  …<u>**Netanyahu’s “First 70 percent” — a doctrine, not a deadline**</u>   Benjamin Netanyahu’s public declaration—“First 70 percent”—delivered at a **West Bank settlement**, formalized an operational reality already underway: IDF maps quietly distributed to aid groups show military control expanded from the ceasefire’s **53% “Yellow Line”** to **64%**, and now the PM is codifying the next phase. Th…

---
### admin-brief-1780036335731#S13  (仅 headline↔noteworthy)
cluster 1 · **det**=headline · **judge**=headline · **codex**=noteworthy
label: EU fines Temu €200 million for illegal and unsafe products under Digital Services Act
对齐器命中块（锚 [fines, temu, million, digital, services] score=16.00）:
  …### economic currents   The **EU’s €200 million fine against Temu** under the Digital Services Act is the first enforcement action targeting a major Chinese e-commerce platform—not for content moderation, but for *systemic risk assessment failures*. The Commission’s criticism—that Temu’s mandatory DSA risk assessment was “not grounded in solid evidence” and “lacking specificity”—signals a new regu…

---
### admin-brief-1780036335731#S14  (仅 headline↔noteworthy)
cluster 5 · **det**=headline · **judge**=headline · **codex**=noteworthy
label: Quad foreign ministers meet in New Delhi to reaffirm alliance amid strategic competition
对齐器命中块（锚 [quad, foreign, ministers, delhi, alliance, strategic] score=17.23）:
  …### power & politics   The **Quad foreign ministers’ meeting in New Delhi**, issuing a joint statement expanding the alliance’s mandate to include **critical minerals, AI, cybersecurity, and maritime surveillance**, arrives amid deliberate strategic counterpoint: just days earlier, Xi hosted Trump, then Putin—signaling authoritarian coordination. The Quad’s pivot toward *economic sovereignty*—espe…
