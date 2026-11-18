document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const forma = document.getElementById("kontaktu-forma");
  if (!forma) return;

  const siustiMygtukas = document.getElementById("siustiMygtukas");
  const isvalytiMygtukas = document.getElementById("isvalytiMygtukas");
  const rezultatas = document.getElementById("formos-rezultatas");

  const laukai = {
    vardas: document.getElementById("vardas"),
    pavarde: document.getElementById("pavarde"),
    elPastas: document.getElementById("elPastas"),
    telefonas: document.getElementById("telefonas"),
    adresas: document.getElementById("adresas"),
    klausimas1: document.getElementById("klausimas1"),
    klausimas2: document.getElementById("klausimas2"),
    klausimas3: document.getElementById("klausimas3"),
  };

  const TIK_RAIDES = /^\p{L}+$/u;
  const EL_PASTO_FORMATAS = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const TELEFONO_FORMATAS = /^\+370 6\d{2} \d{5}$/;

  function vardoTaisykle(reiksme, pavadinimas) {
    if (reiksme === "") return `Įveskite ${pavadinimas}.`;
    if (!TIK_RAIDES.test(reiksme)) return "Galima naudoti tik raides.";
    return "";
  }

  function vertinimoTaisykle(reiksme, laukas) {
    if (laukas.validity.badInput) return "Įveskite skaičių.";
    if (reiksme === "") return "Įvertinkite nuo 1 iki 10.";
    const skaicius = Number(reiksme);
    if (!Number.isInteger(skaicius) || skaicius < 1 || skaicius > 10) {
      return "Leidžiama tik nuo 1 iki 10.";
    }
    return "";
  }

  const taisykles = {
    vardas: (r) => vardoTaisykle(r, "vardą"),
    pavarde: (r) => vardoTaisykle(r, "pavardę"),
    elPastas: (r) => {
      if (r === "") return "Įveskite el. pašto adresą.";
      if (!EL_PASTO_FORMATAS.test(r)) return "Neteisingas el. pašto formatas (pvz. vardas@pastas.lt).";
      return "";
    },
    telefonas: (r) => {
      if (r === "") return "Įveskite telefono numerį.";
      if (!TELEFONO_FORMATAS.test(r)) return "Numeris turi būti formatu +370 6xx xxxxx.";
      return "";
    },
    adresas: (r) => (r === "" ? "Įveskite adresą." : ""),
    klausimas1: vertinimoTaisykle,
    klausimas2: vertinimoTaisykle,
    klausimas3: vertinimoTaisykle,
  };

  function gautiReiksme(pavadinimas) {
    return laukai[pavadinimas].value.trim();
  }

  function patikrintiLauka(pavadinimas, rodytiKlaida) {
    const laukas = laukai[pavadinimas];
    const klaida = taisykles[pavadinimas](gautiReiksme(pavadinimas), laukas);

    if (rodytiKlaida) {
      laukas.classList.toggle("is-invalid", klaida !== "");
      laukas.classList.toggle("is-valid", klaida === "");
      laukas.nextElementSibling.textContent = klaida;
    }
    return klaida === "";
  }

  function visiLaukaiUzpildyti() {
    return Object.keys(laukai).every((pavadinimas) => gautiReiksme(pavadinimas) !== "");
  }

  function formaBeKlaidu() {
    return Object.keys(laukai).every((pavadinimas) => patikrintiLauka(pavadinimas, false));
  }

  function atnaujintiSiustiMygtuka() {
    siustiMygtukas.disabled = !(visiLaukaiUzpildyti() && formaBeKlaidu());
  }

  let ankstesniSkaitmenys = "";

  function formatuotiTelefona(skaitmenys) {
    if (skaitmenys === "") return "";
    let rezultatas = "+370 " + skaitmenys.slice(0, 3);
    if (skaitmenys.length > 3) rezultatas += " " + skaitmenys.slice(3);
    return rezultatas;
  }

  laukai.telefonas.addEventListener("beforeinput", (ivykis) => {
    if (ivykis.inputType === "insertText" && /\D/.test(ivykis.data)) {
      ivykis.preventDefault();
    }
  });

  function tvarkytiTelefonoIvesti(ivykis) {
    const laukas = laukai.telefonas;
    let skaitmenys = laukas.value.replace(/\D/g, "");

    if (skaitmenys.startsWith("370")) {
      skaitmenys = skaitmenys.slice(3);
    } else if (skaitmenys.startsWith("8")) {
      skaitmenys = skaitmenys.slice(1);
    }

    if (ivykis.inputType === "deleteContentBackward" && skaitmenys === ankstesniSkaitmenys) {
      skaitmenys = skaitmenys.slice(0, -1);
    }

    skaitmenys = skaitmenys.slice(0, 8);

    ankstesniSkaitmenys = skaitmenys;
    laukas.value = formatuotiTelefona(skaitmenys);
  }

  Object.entries(laukai).forEach(([pavadinimas, laukas]) => {
    laukas.addEventListener("input", (ivykis) => {
      if (pavadinimas === "telefonas") tvarkytiTelefonoIvesti(ivykis);

      patikrintiLauka(pavadinimas, true);
      atnaujintiSiustiMygtuka();
    });

    laukas.addEventListener("blur", () => {
      patikrintiLauka(pavadinimas, true);
    });
  });

  forma.addEventListener("submit", (ivykis) => {
    ivykis.preventDefault();

    if (!(visiLaukaiUzpildyti() && formaBeKlaidu())) {
      Object.keys(laukai).forEach((pavadinimas) => patikrintiLauka(pavadinimas, true));
      return;
    }

    const duomenys = {
      vardas: gautiReiksme("vardas"),
      pavarde: gautiReiksme("pavarde"),
      elPastas: gautiReiksme("elPastas"),
      telefonas: gautiReiksme("telefonas"),
      adresas: gautiReiksme("adresas"),
      klausimas1: Number(gautiReiksme("klausimas1")),
      klausimas2: Number(gautiReiksme("klausimas2")),
      klausimas3: Number(gautiReiksme("klausimas3")),
    };

    console.log("Formos duomenys:", duomenys);

    const vidurkis = (duomenys.klausimas1 + duomenys.klausimas2 + duomenys.klausimas3) / 3;

    rodytiRezultata(duomenys, vidurkis);
  });

  function sukurtiEilute(pavadinimas, reiksme) {
    const eilute = document.createElement("p");
    const antraste = document.createElement("strong");
    antraste.textContent = pavadinimas + ": ";
    eilute.append(antraste, String(reiksme));
    return eilute;
  }

  function rodytiRezultata(duomenys, vidurkis) {
    const antraste = document.createElement("h4");
    antraste.textContent = "Pateikti duomenys";

    const vidurkioEilute = document.createElement("p");
    vidurkioEilute.className = "vidurkis";
    vidurkioEilute.textContent = `${duomenys.vardas} ${duomenys.pavarde}: ${vidurkis.toFixed(1)}`;

    rezultatas.replaceChildren(
      antraste,
      sukurtiEilute("Vardas", duomenys.vardas),
      sukurtiEilute("Pavardė", duomenys.pavarde),
      sukurtiEilute("El. paštas", duomenys.elPastas),
      sukurtiEilute("Tel. numeris", duomenys.telefonas),
      sukurtiEilute("Adresas", duomenys.adresas),
      sukurtiEilute("Svetainės dizainas", duomenys.klausimas1),
      sukurtiEilute("Informacijos aiškumas", duomenys.klausimas2),
      sukurtiEilute("Rekomendavimo tikimybė", duomenys.klausimas3),
      vidurkioEilute
    );
    rezultatas.hidden = false;
  }

  isvalytiMygtukas.addEventListener("click", () => {
    forma.reset();

    Object.values(laukai).forEach((laukas) => {
      laukas.classList.remove("is-invalid", "is-valid");
      laukas.nextElementSibling.textContent = "";
    });
    ankstesniSkaitmenys = "";

    rezultatas.replaceChildren();
    rezultatas.hidden = true;

    siustiMygtukas.disabled = true;
  });

  atnaujintiSiustiMygtuka();
});
