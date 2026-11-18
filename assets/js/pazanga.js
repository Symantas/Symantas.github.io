document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const modulis = document.getElementById("pazanga");
  if (!modulis) return;

  const BUSENOS = ["Planuojama", "Mokomasi", "Atlikta"];

  const PRADINIAI_IGUDZIAI = [
    { id: 1, pavadinimas: "Python",                        busena: "Atlikta",    xp: 60 },
    { id: 2, pavadinimas: "Git ir GitHub",                 busena: "Atlikta",    xp: 30 },
    { id: 3, pavadinimas: "HTML ir CSS",                   busena: "Atlikta",    xp: 40 },
    { id: 4, pavadinimas: "JavaScript",                    busena: "Mokomasi",   xp: 50 },
    { id: 5, pavadinimas: "SQL ir duomenų bazės",          busena: "Mokomasi",   xp: 40 },
    { id: 6, pavadinimas: "Mašininis mokymasis",           busena: "Mokomasi",   xp: 70 },
    { id: 7, pavadinimas: "Neuroniniai tinklai (PyTorch)", busena: "Planuojama", xp: 80 },
    { id: 8, pavadinimas: "Docker",                        busena: "Planuojama", xp: 30 },
  ];

  const PASIEKIMAI = [
    {
      pavadinimas: "Įgūdžių atradėjas",
      aprasymas: "Atlik bent 1 įgūdį",
      ikona: "bi-compass",
      salyga: (pazanga) => pazanga.atlikta >= 1,
    },
    {
      pavadinimas: "Įgūdžių meistras",
      aprasymas: "Atlik bent 4 įgūdžius",
      ikona: "bi-gem",
      salyga: (pazanga) => pazanga.atlikta >= 4,
    },
    {
      pavadinimas: "Įgūdžių ekspertas",
      aprasymas: "Pasiek 4 lygį",
      ikona: "bi-trophy-fill",
      salyga: (pazanga) => pazanga.lygis === 4,
    },
  ];

  const SAUGYKLOS_RAKTAS = "kp-igudziu-busenos";

  const ikonele = document.getElementById("kp-ikonele");
  const lygioZyme = document.getElementById("kp-lygis");
  const rangoZyme = document.getElementById("kp-rangas");
  const xpZyme = document.getElementById("kp-xp");
  const xpIsVisoZyme = document.getElementById("kp-xp-is-viso");
  const progresoJuosta = modulis.querySelector(".kp-progreso-juosta");
  const progresoUzpildas = document.getElementById("kp-progreso-uzpildas");
  const progresoTekstas = document.getElementById("kp-progreso-tekstas");
  const statViso = document.getElementById("kp-stat-viso");
  const statAtlikta = document.getElementById("kp-stat-atlikta");
  const statProcentas = document.getElementById("kp-stat-procentas");
  const pasiekimuKonteineris = document.getElementById("kp-pasiekimai");
  const atstatytiMygtukas = document.getElementById("kp-atstatyti");

  let igudziai = uzkrautiIgudzius();
  let ankstesnisLygis = null;

  function pradinesBusenos() {
    return PRADINIAI_IGUDZIAI.map((igudis) => ({ ...igudis }));
  }

  function uzkrautiIgudzius() {
    const sarasas = pradinesBusenos();

    try {
      const issaugota = JSON.parse(localStorage.getItem(SAUGYKLOS_RAKTAS));
      if (issaugota) {
        sarasas.forEach((igudis) => {
          const busena = issaugota[igudis.id];
          if (BUSENOS.includes(busena)) igudis.busena = busena;
        });
      }
    } catch {}
    return sarasas;
  }

  function issaugotiIgudzius() {
    const busenos = {};
    igudziai.forEach((igudis) => {
      busenos[igudis.id] = igudis.busena;
    });

    try {
      localStorage.setItem(SAUGYKLOS_RAKTAS, JSON.stringify(busenos));
    } catch {}
  }

  function skaiciuotiXP() {
    return igudziai
      .filter((igudis) => igudis.busena === "Atlikta")
      .reduce((suma, igudis) => suma + igudis.xp, 0);
  }

  function nustatytiLygi(xp) {
    if (xp < 50) {
      return { lygis: 1, rangas: "Pradedantysis", nuo: 0, iki: 50 };
    } else if (xp < 150) {
      return { lygis: 2, rangas: "Praktikantas", nuo: 50, iki: 150 };
    } else if (xp < 300) {
      return { lygis: 3, rangas: "Specialistas", nuo: 150, iki: 300 };
    } else {
      return { lygis: 4, rangas: "Profesionalas", nuo: 300, iki: null };
    }
  }

  function sukurtiKortele(igudis) {
    const kortele = document.createElement("div");
    kortele.className = "kp-kortele";
    kortele.dataset.id = igudis.id;
    kortele.dataset.busena = igudis.busena;

    const pavadinimas = document.createElement("h5");
    pavadinimas.textContent = igudis.pavadinimas;

    const xp = document.createElement("span");
    xp.className = "kp-kortele-xp";
    xp.textContent = `${igudis.xp} XP`;

    const pasirinkimas = document.createElement("select");
    pasirinkimas.className = "kp-busenos-pasirinkimas";
    pasirinkimas.setAttribute("aria-label", `${igudis.pavadinimas} – būsena`);

    BUSENOS.forEach((busena) => {
      const variantas = document.createElement("option");
      variantas.value = busena;
      variantas.textContent = busena;
      variantas.selected = busena === igudis.busena;
      pasirinkimas.append(variantas);
    });

    pasirinkimas.addEventListener("change", () => keistiBusena(igudis.id, pasirinkimas.value));

    const virsus = document.createElement("div");
    virsus.className = "kp-kortele-virsus";
    virsus.append(pavadinimas, xp);

    kortele.append(virsus, pasirinkimas);
    return kortele;
  }

  function atvaizduotiKorteles() {
    modulis.querySelectorAll(".kp-stulpelis").forEach((stulpelis) => {
      const busena = stulpelis.dataset.busena;
      const konteineris = stulpelis.querySelector(".kp-korteles");
      const stulpelioIgudziai = igudziai.filter((igudis) => igudis.busena === busena);

      konteineris.replaceChildren();

      if (stulpelioIgudziai.length === 0) {
        const tuscia = document.createElement("p");
        tuscia.className = "kp-tuscia";
        tuscia.textContent = "Įgūdžių nėra";
        konteineris.append(tuscia);
      }

      stulpelioIgudziai.forEach((igudis) => konteineris.append(sukurtiKortele(igudis)));
      stulpelis.querySelector(".kp-kiekis").textContent = stulpelioIgudziai.length;
    });
  }

  function keistiBusena(id, naujaBusena) {
    const igudis = igudziai.find((i) => i.id === id);
    if (!igudis || !BUSENOS.includes(naujaBusena)) return;

    igudis.busena = naujaBusena;
    issaugotiIgudzius();
    atnaujintiModuli();

    const perkelta = modulis.querySelector(`.kp-kortele[data-id="${id}"]`);
    if (perkelta) perkelta.classList.add("kp-perkelta");
  }

  function atnaujintiProgresa(xp, lygioInfo) {
    xpZyme.textContent = xp;
    lygioZyme.textContent = `${lygioInfo.lygis} lygis`;
    rangoZyme.textContent = lygioInfo.rangas;

    const visiXP = igudziai.reduce((suma, igudis) => suma + igudis.xp, 0);
    xpIsVisoZyme.textContent = `iš ${visiXP} galimų`;

    let procentas;
    if (lygioInfo.lygis === 4) {
      procentas = 100;
      progresoTekstas.textContent = "Maksimalus lygis pasiektas!";
    } else {
      procentas = ((xp - lygioInfo.nuo) / (lygioInfo.iki - lygioInfo.nuo)) * 100;
      const truksta = lygioInfo.iki - xp;
      progresoTekstas.textContent =
        `${xp - lygioInfo.nuo} / ${lygioInfo.iki - lygioInfo.nuo} XP iki ${lygioInfo.lygis + 1} lygio (trūksta ${truksta} XP)`;
    }

    progresoUzpildas.style.width = `${procentas}%`;
    progresoJuosta.setAttribute("aria-valuenow", Math.round(procentas));
  }

  function atnaujintiIkonele(lygis) {
    let failas;

    if (lygis === 1) {
      failas = "avatar-lygis-1.svg";
    } else if (lygis === 2) {
      failas = "avatar-lygis-2.svg";
    } else if (lygis === 3) {
      failas = "avatar-lygis-3.svg";
    } else {
      failas = "avatar-lygis-4.svg";
    }

    ikonele.src = `assets/img/${failas}`;
    ikonele.alt = `Vartotojo ikonėlė – ${lygis} lygis`;

    if (ankstesnisLygis !== null && ankstesnisLygis !== lygis) {
      ikonele.classList.remove("kp-lygio-pokytis");
      void ikonele.offsetWidth;
      ikonele.classList.add("kp-lygio-pokytis");
    }
    ankstesnisLygis = lygis;
  }

  function atnaujintiStatistika(atlikta) {
    const viso = igudziai.length;
    const procentas = viso === 0 ? 0 : Math.round((atlikta / viso) * 100);

    statViso.textContent = viso;
    statAtlikta.textContent = atlikta;
    statProcentas.textContent = `${procentas}%`;
  }

  function sukurtiPasiekimus() {
    PASIEKIMAI.forEach((pasiekimas) => {
      const kortele = document.createElement("div");
      kortele.className = "kp-pasiekimas";

      const ikona = document.createElement("i");
      ikona.className = "bi bi-lock-fill kp-pasiekimo-ikona";

      const tekstas = document.createElement("div");
      const pavadinimas = document.createElement("strong");
      pavadinimas.textContent = pasiekimas.pavadinimas;
      const aprasymas = document.createElement("small");
      aprasymas.textContent = pasiekimas.aprasymas;
      const busena = document.createElement("span");
      busena.className = "kp-pasiekimo-busena";
      busena.textContent = "Neatrakinta";
      tekstas.append(pavadinimas, aprasymas, busena);

      kortele.append(ikona, tekstas);
      pasiekimuKonteineris.append(kortele);
    });
  }

  function atnaujintiPasiekimus(pazanga) {
    const korteles = pasiekimuKonteineris.querySelectorAll(".kp-pasiekimas");

    PASIEKIMAI.forEach((pasiekimas, i) => {
      const kortele = korteles[i];
      const atrakinta = pasiekimas.salyga(pazanga);

      kortele.classList.toggle("atrakinta", atrakinta);
      kortele.querySelector(".kp-pasiekimo-ikona").className =
        `bi ${atrakinta ? pasiekimas.ikona : "bi-lock-fill"} kp-pasiekimo-ikona`;
      kortele.querySelector(".kp-pasiekimo-busena").textContent = atrakinta ? "Atrakinta" : "Neatrakinta";
    });
  }

  function atnaujintiModuli() {
    const xp = skaiciuotiXP();
    const lygioInfo = nustatytiLygi(xp);
    const atlikta = igudziai.filter((igudis) => igudis.busena === "Atlikta").length;

    atvaizduotiKorteles();
    atnaujintiProgresa(xp, lygioInfo);
    atnaujintiIkonele(lygioInfo.lygis);
    atnaujintiStatistika(atlikta);
    atnaujintiPasiekimus({ atlikta: atlikta, lygis: lygioInfo.lygis });
  }

  atstatytiMygtukas.addEventListener("click", () => {
    try {
      localStorage.removeItem(SAUGYKLOS_RAKTAS);
    } catch {}
    igudziai = pradinesBusenos();
    atnaujintiModuli();
  });

  sukurtiPasiekimus();
  atnaujintiModuli();
});
