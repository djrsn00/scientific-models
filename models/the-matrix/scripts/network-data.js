(() => {
  "use strict";

  const engine = (window.NetworkEngine = window.NetworkEngine || {});
  const REGISTRY_ID = "global-deep-sea-fiber-backbone";
  const SCHEMA_VERSION = "1.0.0";
  const owns = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key);

  if (typeof engine !== "object" && typeof engine !== "function") {
    throw new TypeError("NetworkEngine must be an object.");
  }

  if (owns(engine, "DataContract")) {
    const existing = engine.DataContract;

    if (
      existing &&
      existing.registryId === REGISTRY_ID &&
      existing.schemaVersion === SCHEMA_VERSION
    ) {
      return;
    }

    throw new Error("NetworkEngine.DataContract is already registered.");
  }

  const constants = {
    PLANET_RADIUS: 100.0,
    LEO_SHELL_RADIUS: 135.0,
    CABLE_CURVE_SEGMENTS: 64,
    MAX_ACTIVE_PACKETS: 1200,

    EARTH_RADIUS_KM: 6371.0088,
    FIBER_SPEED_KM_PER_SECOND: 200000,

    PACKET_SPAWN_RATE_PER_SECOND: 48,
    PACKET_ANIMATION_TIME_SCALE: 80,
    MIN_PACKET_ANIMATION_MS: 900,
    MAX_PACKET_ANIMATION_MS: 18000,

    TELEMETRY_TICK_MS: 250,
    LASER_HANDOVER_DURATION_MS: 0,

    MIN_ARC_ALTITUDE: 1.02,
    MAX_ARC_ALTITUDE: 1.08,

    EVENT_PACKET_ARRIVED: "NetworkEngine:PacketArrived",
    EVENT_LASER_HANDOVER: "NetworkEngine:LaserHandover",
    EVENT_TELEMETRY_TICK: "NetworkEngine:TelemetryTick"
  };

  const regions = {
    NA: "North America and the North Atlantic",
    EU: "Europe and European Atlantic gateways",
    APAC: "Asia-Pacific",
    AFRICA: "Africa and adjacent Indian Ocean islands",
    LATAM: "Latin America and the Caribbean",
    ME: "Middle East"
  };

  const references = {
    GRACE_HOPPER: {
      title: "Google: Grace Hopper landing in Bude",
      url: "https://blog.google/company-news/inside-google/around-the-globe/google-europe/united-kingdom/our-grace-hopper-subsea-cable-has-landed-uk/"
    },
    MAREA: {
      title: "Telxius: MAREA route and system overview",
      url: "https://telxius.com/en/marea-2/"
    },
    ELLALINK: {
      title: "EllaLink: Fortaleza-Sines cable",
      url: "https://ella.link/press-releases/ambassador-of-portugal-in-brazil-visits-ellalink-cable-landing-station-in-fortaleza/"
    },
    EQUIANO: {
      title: "OADC: Equiano landing network",
      url: "https://openaccessdc.net/equiano-subsea-cable-nigeria"
    },
    FASTER: {
      title: "Google: FASTER trans-Pacific cable",
      url: "https://cloud.google.com/blog/products/gcp/google-cloud-customers-run-at-the-speed-of-light-with-new-faster-undersea-pipe"
    },
    JUPITER: {
      title: "TE SubCom: JUPITER cable system",
      url: "https://www.te.com/en/about-te/news-center/corporate-news/2017/2017-10-29-te-subcom-announces-contract-in-force-for-jupiter-cable-designed-to-boost-high-capacity-connectivity-between-asia-and-united-states.html"
    },
    CURIE: {
      title: "Google: Curie and its Panama branch",
      url: "https://cloud.google.com/blog/products/infrastructure/curie-subsea-cable-set-to-transmit-to-chile-with-a-pit-stop-to-panama"
    },
    SOUTHERN_CROSS: {
      title: "Southern Cross: Pacific cable network",
      url: "https://www.southerncrosscables.com/"
    },
    SACS_MONET: {
      title: "Nokia and Angola Cables: SACS and MONET connections",
      url: "https://www.nokia.com/newsroom/nokia-and-angola-cables-trial-the-first-direct-optical-connection-between-usa-and-africa-with-pse-3-chipset/"
    },
    THREE_VECTOR3: {
      title: "Three.js: Vector3",
      url: "https://threejs.org/docs/pages/Vector3.html"
    }
  };

  // Explicit simulation coverage, not an inventory of every worldwide landing.
  // Coordinates locate coastal landing areas; metropolitan IDs are gateway aliases.
  // Capacity ratings and tiers are simulation budgets, not measured operator data.
  // Row fields: id, name, region, latitude, longitude, tier, capacityTbps.
  const stationRows = [
    ["NYC_USA", "Shirley / New York gateway, United States", "NA", 40.8007, -72.8721, 1, 960],
    ["VAB_USA", "Virginia Beach, United States", "NA", 36.8529, -75.9780, 1, 760],
    ["MYR_USA", "Myrtle Beach, United States", "NA", 33.6891, -78.8867, 2, 320],
    ["MIA_USA", "Boca Raton / Miami gateway, United States", "NA", 26.3683, -80.1289, 1, 600],
    ["JAX_USA", "Jacksonville Beach, United States", "NA", 30.2947, -81.3931, 2, 240],
    ["LAX_USA", "Hermosa Beach / Los Angeles gateway, United States", "NA", 33.8622, -118.3995, 1, 960],
    ["SFO_USA", "Manchester / Northern California gateway, United States", "NA", 38.9699, -123.6869, 1, 640],
    ["PDX_USA", "Bandon / Oregon gateway, United States", "NA", 43.1190, -124.4084, 1, 640],
    ["HNL_USA", "Kahe / Honolulu gateway, United States", "NA", 21.3545, -158.1300, 1, 360],
    ["YVR_CAN", "Port Alberni / Vancouver Island, Canada", "NA", 49.2345, -124.8055, 2, 240],
    ["HAL_CAN", "Herring Cove / Halifax, Canada", "NA", 44.5681, -63.5522, 2, 200],
    ["BDA_BMU", "Hamilton, Bermuda", "NA", 32.2949, -64.7814, 2, 160],

    ["LON_GBR", "Bude / London gateway, United Kingdom", "EU", 50.8280, -4.5440, 1, 880],
    ["BRN_GBR", "Brean, United Kingdom", "EU", 51.2980, -3.0120, 2, 320],
    ["DUB_IRL", "Killala / Ireland gateway, Ireland", "EU", 54.2130, -9.2210, 2, 320],
    ["LIS_PRT", "Carcavelos / Lisbon gateway, Portugal", "EU", 38.6790, -9.3380, 1, 720],
    ["SIE_PRT", "Sines, Portugal", "EU", 37.9560, -8.8690, 1, 600],
    ["SES_PRT", "Sesimbra, Portugal", "EU", 38.4430, -9.1010, 1, 480],
    ["GIB_GIB", "Gibraltar", "EU", 36.1408, -5.3536, 2, 180],
    ["BIL_ESP", "Sopela / Bilbao gateway, Spain", "EU", 43.3820, -2.9820, 1, 560],
    ["MAR_FRA", "Marseille, France", "EU", 43.2965, 5.3698, 1, 960],
    ["LSF_FRA", "Saint-Hilaire-de-Riez, France", "EU", 46.7210, -1.9460, 1, 420],
    ["ESB_DNK", "Esbjerg, Denmark", "EU", 55.4765, 8.4594, 2, 240],
    ["OSL_NOR", "Kristiansand / Norway gateway, Norway", "EU", 58.1467, 7.9956, 2, 200],
    ["REY_ISL", "Thorlakshofn / Iceland gateway, Iceland", "EU", 63.8550, -21.3830, 2, 120],
    ["FUN_PRT", "Funchal, Madeira, Portugal", "EU", 32.6470, -16.9090, 2, 120],
    ["PDL_PRT", "Ponta Delgada, Azores, Portugal", "EU", 37.7412, -25.6756, 2, 120],
    ["BCN_ESP", "Barcelona, Spain", "EU", 41.3851, 2.1734, 2, 320],
    ["PAL_ITA", "Palermo, Italy", "EU", 38.1157, 13.3615, 1, 400],
    ["GEN_ITA", "Genoa, Italy", "EU", 44.4056, 8.9463, 2, 320],
    ["CHA_GRC", "Chania, Crete, Greece", "EU", 35.5138, 24.0180, 2, 220],

    ["TKO_JPN", "Chikura / Tokyo gateway, Japan", "APAC", 34.9750, 139.9540, 1, 960],
    ["SHM_JPN", "Shima, Japan", "APAC", 34.3333, 136.8167, 1, 720],
    ["HKG_HKG", "Tseung Kwan O, Hong Kong", "APAC", 22.3070, 114.2600, 1, 880],
    ["SGP_SGP", "Tuas / Singapore gateway, Singapore", "APAC", 1.3290, 103.6400, 1, 1200],
    ["SYD_AUS", "Sydney, Australia", "APAC", -33.8688, 151.2093, 1, 680],
    ["PER_AUS", "City Beach / Perth gateway, Australia", "APAC", -31.9370, 115.7530, 1, 480],
    ["DRW_AUS", "Darwin, Australia", "APAC", -12.4634, 130.8456, 2, 160],
    ["AKL_NZL", "Takapuna / Auckland gateway, New Zealand", "APAC", -36.7870, 174.7750, 1, 320],
    ["SUV_FJI", "Suva, Fiji", "APAC", -18.1248, 178.4501, 2, 180],
    ["API_WSM", "Apia, Samoa", "APAC", -13.8330, -171.7670, 2, 80],
    ["PPT_PYF", "Papeete, French Polynesia", "APAC", -17.5516, -149.5585, 2, 100],
    ["NOU_NCL", "Noumea, New Caledonia", "APAC", -22.2758, 166.4580, 2, 80],
    ["GUM_USA", "Piti, Guam, United States", "APAC", 13.4620, 144.6934, 1, 480],
    ["BOM_IND", "Mumbai, India", "APAC", 19.0760, 72.8777, 1, 800],
    ["MAA_IND", "Chennai, India", "APAC", 13.0827, 80.2707, 1, 560],
    ["COK_IND", "Kochi, India", "APAC", 9.9312, 76.2673, 2, 240],
    ["CMB_LKA", "Colombo, Sri Lanka", "APAC", 6.9271, 79.8612, 2, 240],
    ["MLE_MDV", "Male, Maldives", "APAC", 4.1755, 73.5093, 2, 80],
    ["KHI_PAK", "Karachi, Pakistan", "APAC", 24.8607, 67.0011, 2, 280],
    ["CXB_BGD", "Cox's Bazar, Bangladesh", "APAC", 21.4272, 92.0058, 2, 200],
    ["BUS_KOR", "Busan, South Korea", "APAC", 35.1796, 129.0756, 1, 480],
    ["TPE_TWN", "Tamsui / Taipei gateway, Taiwan", "APAC", 25.1670, 121.4450, 1, 480],
    ["MNL_PHL", "Batangas / Philippines gateway, Philippines", "APAC", 13.7565, 121.0583, 1, 360],
    ["PEN_MYS", "Penang, Malaysia", "APAC", 5.4141, 100.3288, 2, 280],
    ["JKT_IDN", "Jakarta, Indonesia", "APAC", -6.2088, 106.8456, 1, 400],
    ["BTM_IDN", "Batam, Indonesia", "APAC", 1.1301, 104.0529, 2, 280],
    ["DAD_VNM", "Da Nang, Vietnam", "APAC", 16.0544, 108.2022, 2, 240],
    ["SAT_THA", "Satun, Thailand", "APAC", 6.6238, 100.0674, 2, 200],
    ["SHA_CHN", "Nanhui / Shanghai gateway, China", "APAC", 30.8900, 121.9200, 1, 720],
    ["QDG_CHN", "Qingdao, China", "APAC", 36.0671, 120.3826, 1, 480],
    ["VVO_RUS", "Vladivostok, Russia", "APAC", 43.1155, 131.8855, 2, 200],

    ["FOR_BRA", "Fortaleza, Brazil", "LATAM", -3.7327, -38.5270, 1, 720],
    ["RIO_BRA", "Rio de Janeiro, Brazil", "LATAM", -22.9068, -43.1729, 1, 440],
    ["SAN_BRA", "Santos, Brazil", "LATAM", -23.9608, -46.3336, 1, 560],
    ["VAP_CHL", "Valparaiso, Chile", "LATAM", -33.0472, -71.6127, 1, 320],
    ["LIM_PER", "Lurin / Lima gateway, Peru", "LATAM", -12.2743, -76.8709, 2, 240],
    ["BUE_ARG", "Las Toninas / Buenos Aires gateway, Argentina", "LATAM", -36.4769, -56.6975, 1, 320],
    ["MVD_URY", "Punta del Este / Uruguay gateway, Uruguay", "LATAM", -34.9369, -54.9281, 2, 160],
    ["CTG_COL", "Cartagena, Colombia", "LATAM", 10.3910, -75.4794, 2, 240],
    ["PTY_PAN", "Maria Chiquita / Caribbean Panama gateway, Panama", "LATAM", 9.4430, -79.7540, 1, 360],
    ["BAL_PAN", "Balboa / Pacific Panama gateway, Panama", "LATAM", 8.9490, -79.5660, 1, 360],
    ["SJU_PRI", "San Juan, Puerto Rico", "LATAM", 18.4655, -66.1057, 2, 240],
    ["CUR_CUW", "Willemstad, Curacao", "LATAM", 12.1224, -68.8824, 2, 160],
    ["CUN_MEX", "Cancun, Mexico", "LATAM", 21.1619, -86.8515, 2, 200],

    ["CPT_ZAF", "Melkbosstrand / Cape Town gateway, South Africa", "AFRICA", -33.7277, 18.4440, 1, 520],
    ["DUR_ZAF", "Mtunzini / Durban gateway, South Africa", "AFRICA", -28.9570, 31.7560, 1, 360],
    ["LAG_NGA", "Lagos, Nigeria", "AFRICA", 6.5244, 3.3792, 1, 440],
    ["ACC_GHA", "Accra, Ghana", "AFRICA", 5.6037, -0.1870, 2, 200],
    ["DKR_SEN", "Dakar, Senegal", "AFRICA", 14.7167, -17.4677, 2, 240],
    ["LAD_AGO", "Sangano / Luanda gateway, Angola", "AFRICA", -9.5326, 13.2053, 1, 320],
    ["SWP_NAM", "Swakopmund, Namibia", "AFRICA", -22.6783, 14.5266, 2, 160],
    ["MBA_KEN", "Mombasa, Kenya", "AFRICA", -4.0435, 39.6682, 1, 320],
    ["DAR_TZA", "Dar es Salaam, Tanzania", "AFRICA", -6.7924, 39.2083, 2, 200],
    ["DJB_DJI", "Djibouti City, Djibouti", "AFRICA", 11.5721, 43.1456, 1, 560],
    ["MGQ_SOM", "Mogadishu, Somalia", "AFRICA", 2.0469, 45.3182, 2, 100],
    ["PLA_MUS", "Baie du Jacotet, Mauritius", "AFRICA", -20.4827, 57.4505, 2, 160],
    ["RUN_REU", "Saint-Paul, Reunion", "AFRICA", -21.0095, 55.2698, 2, 120],
    ["TOL_MDG", "Toliara, Madagascar", "AFRICA", -23.3549, 43.6660, 2, 100],
    ["VIC_SYC", "Victoria, Mahe, Seychelles", "AFRICA", -4.6191, 55.4513, 2, 80],
    ["CAS_MAR", "Casablanca, Morocco", "AFRICA", 33.5731, -7.5898, 2, 240],
    ["ALX_EGY", "Alexandria, Egypt", "AFRICA", 31.2001, 29.9187, 1, 640],
    ["SUE_EGY", "Suez, Egypt", "AFRICA", 29.9668, 32.5498, 1, 640],
    ["LOM_TGO", "Lome, Togo", "AFRICA", 6.1256, 1.2254, 2, 120],
    ["ABI_CIV", "Abidjan, Cote d'Ivoire", "AFRICA", 5.3600, -4.0083, 2, 160],

    ["DXB_ARE", "Fujairah / Dubai gateway, United Arab Emirates", "ME", 25.1288, 56.3265, 1, 720],
    ["MCT_OMN", "Al Seeb / Muscat gateway, Oman", "ME", 23.6703, 58.1891, 1, 440],
    ["SLL_OMN", "Salalah, Oman", "ME", 17.0194, 54.0897, 2, 280],
    ["JED_SAU", "Jeddah, Saudi Arabia", "ME", 21.4858, 39.1925, 1, 440],
    ["DOH_QAT", "Doha, Qatar", "ME", 25.2854, 51.5310, 2, 220],
    ["MAN_BHR", "Manama, Bahrain", "ME", 26.2235, 50.5876, 2, 200],
    ["TLV_ISR", "Tel Aviv, Israel", "ME", 32.0853, 34.7818, 2, 260]
  ];

  const stations = Object.create(null);

  for (const row of stationRows) {
    const [id, name, region, lat, lon, tier, capacityTbps] = row;

    if (
      owns(stations, id) ||
      !/^[A-Z0-9]+_[A-Z]{3}$/.test(id) ||
      !name ||
      !owns(regions, region) ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180 ||
      (tier !== 1 && tier !== 2) ||
      !Number.isFinite(capacityTbps) ||
      capacityTbps <= 0
    ) {
      throw new Error("Invalid or duplicate station: " + id);
    }

    stations[id] = {
      id,
      name,
      region,
      lat,
      lon,
      tier,
      capacityTbps,
      role: tier === 1 ? "CORE_HUB" : "REGIONAL_ANCHOR",
      coordinateKind: "APPROXIMATE_LANDING_LOCALITY",
      capacityBasis: "SIMULATED_AGGREGATE"
    };
  }

  const stationIds = Object.keys(stations);
  const DEG_TO_RAD = Math.PI / 180;

  function surfaceDistanceKm(a, b) {
    const dLat = (b.lat - a.lat) * DEG_TO_RAD;
    const dLon = (b.lon - a.lon) * DEG_TO_RAD;

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * DEG_TO_RAD) *
        Math.cos(b.lat * DEG_TO_RAD) *
        Math.sin(dLon / 2) ** 2;

    return (
      2 *
      constants.EARTH_RADIUS_KM *
      Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))))
    );
  }

  const routesById = Object.create(null);
  const adjacency = Object.create(null);

  for (const id of stationIds) {
    adjacency[id] = [];
  }

  // CABLE_CORRIDOR identifies a published cable's abstracted connection.
  // SIMULATED_CORRIDOR is an authored geographic corridor, not a named asset.
  // COMPOSITE_CORRIDOR represents several connections as one logical edge.
  // All distances are approximate path budgets, not surveyed cable geometry.
  function R(
    id,
    source,
    target,
    cableName,
    distanceKm,
    arcAltitude,
    options = {}
  ) {
    const via = options.via ? options.via.slice() : [];
    const referenceIds = options.referenceIds
      ? options.referenceIds.slice()
      : [];

    const transport = options.transport || "SUBSEA";
    const basis = options.basis || "SIMULATED_CORRIDOR";
    const pathIds = [source].concat(via, target);

    if (
      !id ||
      owns(routesById, id) ||
      source === target ||
      pathIds.some(nodeId => !owns(stations, nodeId)) ||
      new Set(pathIds).size !== pathIds.length ||
      !cableName ||
      !Number.isFinite(distanceKm) ||
      distanceKm <= 0 ||
      !Number.isFinite(arcAltitude) ||
      arcAltitude < constants.MIN_ARC_ALTITUDE ||
      arcAltitude > constants.MAX_ARC_ALTITUDE ||
      !["SUBSEA", "TERRESTRIAL", "HYBRID"].includes(transport) ||
      ![
        "CABLE_CORRIDOR",
        "SIMULATED_CORRIDOR",
        "COMPOSITE_CORRIDOR"
      ].includes(basis) ||
      referenceIds.some(key => !owns(references, key)) ||
      (basis === "CABLE_CORRIDOR" && referenceIds.length === 0)
    ) {
      throw new Error("Invalid or duplicate route: " + id);
    }

    let minimumDistanceKm = 0;

    for (let i = 1; i < pathIds.length; i++) {
      minimumDistanceKm += surfaceDistanceKm(
        stations[pathIds[i - 1]],
        stations[pathIds[i]]
      );
    }

    if (distanceKm < minimumDistanceKm) {
      throw new RangeError(
        "Fiber path is shorter than its surface path: " + id
      );
    }

    const route = {
      id,
      source,
      target,
      cableName,
      distanceKm,
      baseLatencyMs:
        Math.round(
          distanceKm / constants.FIBER_SPEED_KM_PER_SECOND * 1000000
        ) / 1000,
      arcAltitude,
      bidirectional: true,
      transport,
      basis,
      via,
      referenceIds,
      distanceBasis: "APPROXIMATE_FIBER_PATH"
    };

    routesById[id] = route;
    adjacency[source].push(id);
    adjacency[target].push(id);

    return route;
  }

  // arcAltitude is an apex radius multiplier, not an additive world-space height.
  // A curve may use radius(t) = PLANET_RADIUS *
  // (1 + (arcAltitude - 1) * sin(PI * t)). Endpoints remain on the surface.
  // Composite via IDs are display/path hints; adjacency stores logical endpoints.
  const routes = [
    R("GRACE-HOPPER-UK", "NYC_USA", "LON_GBR", "Grace Hopper / UK corridor", 6250, 1.070, { basis: "CABLE_CORRIDOR", referenceIds: ["GRACE_HOPPER"] }),
    R("GRACE-HOPPER-ES", "NYC_USA", "BIL_ESP", "Grace Hopper / Spain corridor", 6300, 1.070, { basis: "CABLE_CORRIDOR", referenceIds: ["GRACE_HOPPER"] }),
    R("MAREA-CORRIDOR", "VAB_USA", "BIL_ESP", "MAREA", 6600, 1.075, { basis: "CABLE_CORRIDOR", referenceIds: ["MAREA"] }),
    R("ATL-NYC-LIS", "NYC_USA", "LIS_PRT", "New York-Iberia Gateway", 7300, 1.075, { basis: "COMPOSITE_CORRIDOR", transport: "HYBRID", via: ["BIL_ESP"] }),
    R("ATL-VAB-LSF", "VAB_USA", "LSF_FRA", "Virginia-Biscay Corridor", 6600, 1.070),
    R("ATL-HAL-LON", "HAL_CAN", "LON_GBR", "Canadian Atlantic Gateway", 5300, 1.065),
    R("ATL-HAL-DUB", "HAL_CAN", "DUB_IRL", "North Atlantic Diversity", 4900, 1.060),
    R("ATL-REY-DUB", "REY_ISL", "DUB_IRL", "Iceland-Ireland Gateway", 2200, 1.045),
    R("ATL-NYC-BDA", "NYC_USA", "BDA_BMU", "Bermuda Atlantic Access", 1600, 1.035),
    R("ATL-BDA-PDL", "BDA_BMU", "PDL_PRT", "Mid-Atlantic Island Corridor", 3900, 1.050),
    R("ATL-PDL-LIS", "PDL_PRT", "LIS_PRT", "Azores-Portugal Corridor", 1900, 1.040),
    R("ATL-BDA-SIE", "BDA_BMU", "SIE_PRT", "Bermuda-Iberia Diversity", 5200, 1.060),
    R("ELLALINK-MAIN", "FOR_BRA", "SIE_PRT", "EllaLink", 6000, 1.070, { basis: "CABLE_CORRIDOR", referenceIds: ["ELLALINK"] }),
    R("ELLALINK-LISBON", "FOR_BRA", "LIS_PRT", "EllaLink / Lisbon backhaul", 6300, 1.075, { basis: "COMPOSITE_CORRIDOR", transport: "HYBRID", via: ["SIE_PRT"], referenceIds: ["ELLALINK"] }),

    R("PT-SIE-LIS", "SIE_PRT", "LIS_PRT", "Sines-Lisbon Backhaul", 180, 1.020, { transport: "TERRESTRIAL" }),
    R("PT-LIS-SES", "LIS_PRT", "SES_PRT", "Lisbon-Sesimbra Backhaul", 70, 1.020, { transport: "TERRESTRIAL" }),
    R("EU-LON-LIS", "LON_GBR", "LIS_PRT", "Iberian Atlantic Corridor", 1850, 1.040),
    R("EU-LON-BRN", "LON_GBR", "BRN_GBR", "Cornwall-Bristol Channel", 420, 1.025),
    R("EU-LON-DUB", "LON_GBR", "DUB_IRL", "Celtic Sea Gateway", 1000, 1.030),
    R("EU-LON-ESB", "LON_GBR", "ESB_DNK", "North Sea Diversity", 1900, 1.040),
    R("EU-ESB-OSL", "ESB_DNK", "OSL_NOR", "Skagerrak Gateway", 430, 1.025),
    R("EU-LIS-FUN", "LIS_PRT", "FUN_PRT", "Madeira-Portugal Corridor", 1250, 1.035),
    R("EU-FUN-SIE", "FUN_PRT", "SIE_PRT", "Madeira-Sines Diversity", 1150, 1.030),
    R("EU-LIS-GIB", "LIS_PRT", "GIB_GIB", "Iberian Coastal Corridor", 650, 1.025),
    R("MED-GIB-MAR", "GIB_GIB", "MAR_FRA", "Western Mediterranean Gateway", 1900, 1.040),
    R("MED-MAR-BCN", "MAR_FRA", "BCN_ESP", "Gulf of Lion Corridor", 600, 1.025),
    R("MED-MAR-GEN", "MAR_FRA", "GEN_ITA", "Ligurian Sea Gateway", 650, 1.025),
    R("MED-MAR-PAL", "MAR_FRA", "PAL_ITA", "Tyrrhenian Gateway", 1300, 1.035),
    R("MED-GEN-PAL", "GEN_ITA", "PAL_ITA", "Italian Coastal Diversity", 1100, 1.030),
    R("MED-PAL-CHA", "PAL_ITA", "CHA_GRC", "Central Mediterranean Corridor", 1450, 1.035),
    R("MED-PAL-ALX", "PAL_ITA", "ALX_EGY", "Sicily-Egypt Gateway", 2300, 1.045),
    R("MED-MAR-ALX", "MAR_FRA", "ALX_EGY", "Mediterranean-East Gateway", 3100, 1.050),
    R("MED-CHA-TLV", "CHA_GRC", "TLV_ISR", "Levant Gateway", 1450, 1.035),
    R("MED-GIB-CAS", "GIB_GIB", "CAS_MAR", "Strait of Gibraltar Access", 650, 1.025),

    R("EUR-ASIA-LIS-DXB", "LIS_PRT", "DXB_ARE", "Europe-Arabian Gateway", 14500, 1.080, { basis: "COMPOSITE_CORRIDOR", transport: "HYBRID", via: ["GIB_GIB", "MAR_FRA", "ALX_EGY", "SUE_EGY", "JED_SAU", "DJB_DJI", "MCT_OMN"] }),
    R("ARABIA-DXB-BOM", "DXB_ARE", "BOM_IND", "Arabian Sea Express", 2600, 1.045),
    R("INDIA-BOM-SGP", "BOM_IND", "SGP_SGP", "India-Straits Gateway", 6200, 1.065, { basis: "COMPOSITE_CORRIDOR", via: ["COK_IND", "CMB_LKA"] }),
    R("ASIA-SGP-TKO", "SGP_SGP", "TKO_JPN", "East Asian Backbone", 7800, 1.070, { basis: "COMPOSITE_CORRIDOR", via: ["HKG_HKG", "SHM_JPN"] }),
    R("INDIAN-CPT-BOM", "CPT_ZAF", "BOM_IND", "Southern Indian Ocean Gateway", 11500, 1.080, { basis: "COMPOSITE_CORRIDOR", via: ["DUR_ZAF", "PLA_MUS", "COK_IND"] }),
    R("SOUTH-ATL-FOR-CPT", "FOR_BRA", "CPT_ZAF", "South Atlantic-Cape Gateway", 9800, 1.080, { basis: "COMPOSITE_CORRIDOR", via: ["LAD_AGO"] }),

    R("US-NYC-VAB", "NYC_USA", "VAB_USA", "US East Coast Backhaul", 780, 1.025, { transport: "TERRESTRIAL" }),
    R("US-VAB-MYR", "VAB_USA", "MYR_USA", "Carolina Coastal Corridor", 550, 1.025),
    R("US-MYR-JAX", "MYR_USA", "JAX_USA", "Southeastern Coastal Corridor", 600, 1.025),
    R("US-JAX-MIA", "JAX_USA", "MIA_USA", "Florida Coastal Corridor", 620, 1.025),
    R("US-LAX-SFO", "LAX_USA", "SFO_USA", "California Coastal Corridor", 1250, 1.035),
    R("US-SFO-PDX", "SFO_USA", "PDX_USA", "Pacific Northwest Corridor", 950, 1.030),
    R("US-PDX-YVR", "PDX_USA", "YVR_CAN", "Cascadia Coastal Gateway", 1400, 1.035),

    R("PAC-LAX-HNL", "LAX_USA", "HNL_USA", "California-Hawaii Gateway", 4600, 1.060),
    R("PAC-TKO-HNL", "TKO_JPN", "HNL_USA", "North Pacific Gateway", 6900, 1.075),
    R("PAC-HNL-NYC", "HNL_USA", "NYC_USA", "Hawaii-US Continental Gateway", 9800, 1.080, { basis: "COMPOSITE_CORRIDOR", transport: "HYBRID", via: ["LAX_USA"] }),
    R("FASTER-CORRIDOR", "PDX_USA", "TKO_JPN", "FASTER / Japan-US corridor", 9700, 1.080, { basis: "CABLE_CORRIDOR", referenceIds: ["FASTER"] }),
    R("JUPITER-CORRIDOR", "LAX_USA", "SHM_JPN", "JUPITER / Japan-US corridor", 11100, 1.080, { basis: "CABLE_CORRIDOR", referenceIds: ["JUPITER"] }),
    R("PAC-SFO-TKO", "SFO_USA", "TKO_JPN", "Northern Pacific Diversity", 9300, 1.075),
    R("CURIE-MAIN", "LAX_USA", "VAP_CHL", "Curie / Chile corridor", 10500, 1.080, { basis: "CABLE_CORRIDOR", referenceIds: ["CURIE"] }),
    R("CURIE-PANAMA", "LAX_USA", "BAL_PAN", "Curie / Panama corridor", 6200, 1.070, { basis: "CABLE_CORRIDOR", referenceIds: ["CURIE"] }),
    R("SX-HNL-SUV", "HNL_USA", "SUV_FJI", "Southern Cross / Hawaii-Fiji corridor", 6200, 1.065, { basis: "CABLE_CORRIDOR", referenceIds: ["SOUTHERN_CROSS"] }),
    R("SX-SUV-AKL", "SUV_FJI", "AKL_NZL", "Southern Cross / Fiji-New Zealand corridor", 2700, 1.045, { basis: "CABLE_CORRIDOR", referenceIds: ["SOUTHERN_CROSS"] }),
    R("SX-SYD-AKL", "SYD_AUS", "AKL_NZL", "Southern Cross / Tasman corridor", 2400, 1.040, { basis: "CABLE_CORRIDOR", referenceIds: ["SOUTHERN_CROSS"] }),
    R("SX-NEXT-AKL-LAX", "AKL_NZL", "LAX_USA", "Southern Cross NEXT / New Zealand-US corridor", 13500, 1.080, { basis: "CABLE_CORRIDOR", referenceIds: ["SOUTHERN_CROSS"] }),
    R("PAC-SYD-HNL", "SYD_AUS", "HNL_USA", "Austral-Pacific Gateway", 9700, 1.075),
    R("PAC-TKO-SYD", "TKO_JPN", "SYD_AUS", "Japan-Australia Gateway", 10000, 1.080, { basis: "COMPOSITE_CORRIDOR", via: ["GUM_USA"] }),
    R("PAC-GUM-TKO", "GUM_USA", "TKO_JPN", "Marianas-Japan Gateway", 3000, 1.045),
    R("PAC-GUM-MNL", "GUM_USA", "MNL_PHL", "Marianas-Philippines Gateway", 3500, 1.050),
    R("PAC-GUM-LAX", "GUM_USA", "LAX_USA", "Western Pacific-US Gateway", 11800, 1.080),
    R("PAC-SYD-NOU", "SYD_AUS", "NOU_NCL", "Coral Sea Gateway", 2500, 1.040),
    R("PAC-NOU-SUV", "NOU_NCL", "SUV_FJI", "Melanesian Island Corridor", 1800, 1.035),
    R("PAC-SUV-API", "SUV_FJI", "API_WSM", "Fiji-Samoa Corridor", 1500, 1.035),
    R("PAC-API-PPT", "API_WSM", "PPT_PYF", "Polynesian Island Corridor", 2800, 1.045),
    R("PAC-PPT-HNL", "PPT_PYF", "HNL_USA", "Polynesia-Hawaii Gateway", 5200, 1.060),

    R("AUS-PER-SGP", "PER_AUS", "SGP_SGP", "Australia-Straits Gateway", 5000, 1.060),
    R("AUS-PER-SYD", "PER_AUS", "SYD_AUS", "Southern Australia Coastal Corridor", 5700, 1.060),
    R("AUS-PER-DRW", "PER_AUS", "DRW_AUS", "Northwest Australia Corridor", 4500, 1.050),
    R("AUS-DRW-SGP", "DRW_AUS", "SGP_SGP", "Timor-Straits Gateway", 3800, 1.050),
    R("AUS-JKT-PER", "JKT_IDN", "PER_AUS", "Java-Australia Gateway", 4500, 1.050),

    R("ASIA-SGP-PEN", "SGP_SGP", "PEN_MYS", "Malacca Strait Corridor", 1000, 1.030),
    R("ASIA-PEN-SAT", "PEN_MYS", "SAT_THA", "Andaman Access Corridor", 200, 1.020),
    R("ASIA-SGP-JKT", "SGP_SGP", "JKT_IDN", "Java Sea Gateway", 1250, 1.035),
    R("ASIA-SGP-BTM", "SGP_SGP", "BTM_IDN", "Singapore-Batam Interconnect", 100, 1.020),
    R("ASIA-JKT-BTM", "JKT_IDN", "BTM_IDN", "Indonesian Western Corridor", 1100, 1.030),
    R("ASIA-SGP-HKG", "SGP_SGP", "HKG_HKG", "South China Sea Backbone", 4200, 1.055),
    R("ASIA-HKG-DAD", "HKG_HKG", "DAD_VNM", "Vietnam-Hong Kong Gateway", 1400, 1.035),
    R("ASIA-SGP-DAD", "SGP_SGP", "DAD_VNM", "Indochina-Straits Gateway", 2700, 1.045),
    R("ASIA-HKG-TPE", "HKG_HKG", "TPE_TWN", "Northern South China Sea Corridor", 1400, 1.035),
    R("ASIA-TPE-SHM", "TPE_TWN", "SHM_JPN", "Ryukyu Gateway", 2100, 1.040),
    R("ASIA-SHM-TKO", "SHM_JPN", "TKO_JPN", "Japanese Pacific Coastal Corridor", 500, 1.025),
    R("ASIA-SHM-BUS", "SHM_JPN", "BUS_KOR", "Korea-Japan Gateway", 900, 1.030),
    R("ASIA-TKO-QDG", "TKO_JPN", "QDG_CHN", "Northeast Asia Diversity", 2600, 1.045),
    R("ASIA-BUS-SHA", "BUS_KOR", "SHA_CHN", "East China Sea Gateway", 1400, 1.035),
    R("ASIA-SHA-HKG", "SHA_CHN", "HKG_HKG", "China Coastal Backbone", 2100, 1.040),
    R("ASIA-SHA-QDG", "SHA_CHN", "QDG_CHN", "Yellow Sea Coastal Corridor", 1050, 1.030),
    R("ASIA-BUS-VVO", "BUS_KOR", "VVO_RUS", "Northern Sea of Japan Gateway", 1400, 1.035),
    R("ASIA-HKG-MNL", "HKG_HKG", "MNL_PHL", "Luzon-Hong Kong Gateway", 1800, 1.040),
    R("ASIA-MNL-SGP", "MNL_PHL", "SGP_SGP", "Philippines-Straits Gateway", 3300, 1.050),

    R("INDIA-BOM-COK", "BOM_IND", "COK_IND", "Indian Western Coastal Corridor", 1400, 1.035),
    R("INDIA-COK-CMB", "COK_IND", "CMB_LKA", "Laccadive Sea Gateway", 850, 1.030),
    R("INDIA-CMB-MLE", "CMB_LKA", "MLE_MDV", "Maldives-Sri Lanka Corridor", 1300, 1.035),
    R("INDIA-CMB-PEN", "CMB_LKA", "PEN_MYS", "Bengal-Andaman Gateway", 3800, 1.050),
    R("INDIA-CMB-MAA", "CMB_LKA", "MAA_IND", "Sri Lanka-Chennai Corridor", 950, 1.030),
    R("INDIA-MAA-SGP", "MAA_IND", "SGP_SGP", "Bay of Bengal Backbone", 3600, 1.050),
    R("INDIA-CXB-MAA", "CXB_BGD", "MAA_IND", "Bengal Regional Corridor", 2800, 1.045),
    R("INDIA-CXB-SGP", "CXB_BGD", "SGP_SGP", "Bangladesh-Straits Gateway", 4700, 1.055, { basis: "COMPOSITE_CORRIDOR", via: ["PEN_MYS"] }),
    R("ARABIA-KHI-MCT", "KHI_PAK", "MCT_OMN", "Gulf of Oman Gateway", 1800, 1.040),
    R("ARABIA-DXB-KHI", "DXB_ARE", "KHI_PAK", "Pakistan-Emirates Gateway", 2200, 1.040),
    R("ARABIA-KHI-BOM", "KHI_PAK", "BOM_IND", "Northern Arabian Sea Diversity", 1600, 1.035),

    R("EQUIANO-MAIN", "SES_PRT", "CPT_ZAF", "Equiano / Portugal-South Africa corridor", 13800, 1.080, { basis: "CABLE_CORRIDOR", referenceIds: ["EQUIANO"] }),
    R("EQUIANO-LISBON", "LIS_PRT", "CPT_ZAF", "Equiano / Lisbon backhaul", 14000, 1.080, { basis: "COMPOSITE_CORRIDOR", transport: "HYBRID", via: ["SES_PRT"], referenceIds: ["EQUIANO"] }),
    R("EQUIANO-NIGERIA", "SES_PRT", "LAG_NGA", "Equiano / Nigeria corridor", 8400, 1.070, { basis: "CABLE_CORRIDOR", referenceIds: ["EQUIANO"] }),
    R("AFR-LIS-DKR", "LIS_PRT", "DKR_SEN", "Northwest African Gateway", 4000, 1.050),
    R("AFR-DKR-ABI", "DKR_SEN", "ABI_CIV", "West African Coastal Corridor", 2900, 1.045),
    R("AFR-ABI-ACC", "ABI_CIV", "ACC_GHA", "Gulf of Guinea West", 750, 1.025),
    R("AFR-ACC-LOM", "ACC_GHA", "LOM_TGO", "Ghana-Togo Corridor", 320, 1.020),
    R("AFR-LOM-LAG", "LOM_TGO", "LAG_NGA", "Gulf of Guinea East", 450, 1.025),
    R("AFR-LAG-LAD", "LAG_NGA", "LAD_AGO", "Equatorial Atlantic Gateway", 4400, 1.055),
    R("AFR-LAD-SWP", "LAD_AGO", "SWP_NAM", "Southwest African Corridor", 2500, 1.045),
    R("AFR-SWP-CPT", "SWP_NAM", "CPT_ZAF", "Namibia-Cape Gateway", 1700, 1.035),
    R("AFR-LIS-CAS", "LIS_PRT", "CAS_MAR", "Morocco-Portugal Gateway", 1000, 1.030),
    R("AFR-CPT-DUR", "CPT_ZAF", "DUR_ZAF", "Cape-Indian Ocean Corridor", 2500, 1.045),
    R("AFR-DUR-DAR", "DUR_ZAF", "DAR_TZA", "Eastern African Backbone", 4000, 1.050),
    R("AFR-DAR-MBA", "DAR_TZA", "MBA_KEN", "Swahili Coast Corridor", 650, 1.025),
    R("AFR-MBA-MGQ", "MBA_KEN", "MGQ_SOM", "Somali Coastal Access", 1600, 1.035),
    R("AFR-MGQ-DJB", "MGQ_SOM", "DJB_DJI", "Horn of Africa Corridor", 3300, 1.050),
    R("AFR-DJB-MBA", "DJB_DJI", "MBA_KEN", "Horn of Africa Diversity", 3800, 1.050),
    R("AFR-DJB-SLL", "DJB_DJI", "SLL_OMN", "Gulf of Aden Gateway", 2600, 1.045),
    R("AFR-DUR-PLA", "DUR_ZAF", "PLA_MUS", "Southwest Indian Ocean Gateway", 3900, 1.050),
    R("AFR-PLA-RUN", "PLA_MUS", "RUN_REU", "Mascarene Islands Corridor", 400, 1.025),
    R("AFR-RUN-TOL", "RUN_REU", "TOL_MDG", "Madagascar-Mascarene Gateway", 2100, 1.040),
    R("AFR-DAR-VIC", "DAR_TZA", "VIC_SYC", "Seychelles-East Africa Gateway", 2500, 1.045),
    R("AFR-VIC-BOM", "VIC_SYC", "BOM_IND", "Seychelles-India Gateway", 4300, 1.055),
    R("AFR-PLA-COK", "PLA_MUS", "COK_IND", "Mauritius-India Gateway", 5500, 1.060),
    R("AFR-DAR-BOM", "DAR_TZA", "BOM_IND", "East Africa-India Express", 7500, 1.075),

    R("RED-ALX-SUE", "ALX_EGY", "SUE_EGY", "Egypt Cross-Country Fiber", 400, 1.020, { transport: "TERRESTRIAL" }),
    R("RED-SUE-JED", "SUE_EGY", "JED_SAU", "Northern Red Sea Corridor", 2000, 1.040),
    R("RED-JED-DJB", "JED_SAU", "DJB_DJI", "Southern Red Sea Corridor", 2200, 1.040),
    R("ME-SLL-MCT", "SLL_OMN", "MCT_OMN", "Oman Coastal Corridor", 1700, 1.035),
    R("ME-MCT-DXB", "MCT_OMN", "DXB_ARE", "Oman-Emirates Gateway", 600, 1.025),
    R("ME-MCT-BOM", "MCT_OMN", "BOM_IND", "Oman-India Gateway", 2600, 1.045),
    R("ME-DXB-DOH", "DXB_ARE", "DOH_QAT", "Arabian Gulf Gateway", 1150, 1.030),
    R("ME-DOH-MAN", "DOH_QAT", "MAN_BHR", "Qatar-Bahrain Corridor", 260, 1.020),
    R("ME-TLV-ALX", "TLV_ISR", "ALX_EGY", "Levant-Egypt Corridor", 950, 1.030),

    R("SACS-CORRIDOR", "FOR_BRA", "LAD_AGO", "South Atlantic Cable System", 6200, 1.070, { basis: "CABLE_CORRIDOR", referenceIds: ["SACS_MONET"] }),
    R("MONET-US-BR", "MIA_USA", "FOR_BRA", "MONET / Florida-Brazil corridor", 7800, 1.075, { basis: "CABLE_CORRIDOR", referenceIds: ["SACS_MONET"] }),
    R("MONET-BR-COAST", "FOR_BRA", "SAN_BRA", "MONET / Brazilian corridor", 3500, 1.050, { basis: "CABLE_CORRIDOR", referenceIds: ["SACS_MONET"] }),
    R("LATAM-SAN-RIO", "SAN_BRA", "RIO_BRA", "Southeast Brazilian Corridor", 650, 1.025),
    R("LATAM-RIO-FOR", "RIO_BRA", "FOR_BRA", "Brazilian Atlantic Backbone", 3300, 1.050),
    R("LATAM-SAN-MVD", "SAN_BRA", "MVD_URY", "Southern Cone Atlantic Gateway", 2500, 1.045),
    R("LATAM-MVD-BUE", "MVD_URY", "BUE_ARG", "Rio de la Plata Gateway", 550, 1.025),
    R("LATAM-BUE-RIO", "BUE_ARG", "RIO_BRA", "Southern Cone Diversity", 3300, 1.050),
    R("LATAM-VAP-LIM", "VAP_CHL", "LIM_PER", "Humboldt Pacific Corridor", 3400, 1.050),
    R("LATAM-LIM-BAL", "LIM_PER", "BAL_PAN", "Andean Pacific Gateway", 3500, 1.050),
    R("LATAM-BAL-PTY", "BAL_PAN", "PTY_PAN", "Panama Isthmus Fiber", 110, 1.020, { transport: "TERRESTRIAL" }),
    R("LATAM-PTY-CTG", "PTY_PAN", "CTG_COL", "Colombia-Panama Caribbean Gateway", 700, 1.025),
    R("LATAM-PTY-SJU", "PTY_PAN", "SJU_PRI", "Caribbean Backbone", 2700, 1.045),
    R("LATAM-SJU-MIA", "SJU_PRI", "MIA_USA", "Puerto Rico-Florida Gateway", 2500, 1.045),
    R("LATAM-SJU-CUR", "SJU_PRI", "CUR_CUW", "Eastern Caribbean Corridor", 1100, 1.030),
    R("LATAM-CUR-CTG", "CUR_CUW", "CTG_COL", "Southern Caribbean Corridor", 1300, 1.035),
    R("LATAM-MIA-CUN", "MIA_USA", "CUN_MEX", "Florida-Yucatan Gateway", 1500, 1.035),
    R("LATAM-CUN-PTY", "CUN_MEX", "PTY_PAN", "Western Caribbean Gateway", 2800, 1.045)
  ];

  // Traffic weights sum to one across the global emitter.
  // Byte envelopes describe logical messages/chunks, not Ethernet frame sizes.
  // ttlMs is simulated lifetime; it is not the IP hop-limit field.
  // velocityFactor affects animation only, never physical propagation delay.
  const packetClasses = {
    HTTP_PING: {
      id: "HTTP_PING",
      label: "HTTP ping",
      color: "#ffd000",
      weight: 0.40,
      frequency: "HIGH",
      payloadType: "LIGHT_CONTROL",
      velocityFactor: 1.4,
      byteSize: {
        min: 64,
        typical: 512,
        max: 1536
      },
      ttlMs: 16000,
      burst: {
        min: 1,
        max: 3
      },
      transport: "FIBER",
      trajectory: "CABLE",
      cssClass: "packet--http-ping",
      uiClass: "payload--http-ping",
      arrivalEvent: constants.EVENT_PACKET_ARRIVED
    },

    BACKUP_PAYLOAD: {
      id: "BACKUP_PAYLOAD",
      label: "Backup payload",
      color: "#5c6ac4",
      weight: 0.22,
      frequency: "MEDIUM",
      payloadType: "HEAVY_BULK",
      velocityFactor: 0.7,
      byteSize: {
        min: 65536,
        typical: 1048576,
        max: 8388608
      },
      ttlMs: 45000,
      burst: {
        min: 1,
        max: 2
      },
      transport: "FIBER",
      trajectory: "CABLE",
      cssClass: "packet--backup-payload",
      uiClass: "payload--backup-payload",
      arrivalEvent: constants.EVENT_PACKET_ARRIVED
    },

    TLS_HANDSHAKE: {
      id: "TLS_HANDSHAKE",
      label: "TLS handshake",
      color: "#00ff66",
      weight: 0.33,
      frequency: "HIGH_BURST",
      payloadType: "CRYPTOGRAPHIC",
      velocityFactor: 1.2,
      byteSize: {
        min: 512,
        typical: 6144,
        max: 32768
      },
      ttlMs: 16000,
      burst: {
        min: 3,
        max: 8
      },
      transport: "FIBER",
      trajectory: "CABLE",
      cssClass: "packet--tls-handshake",
      uiClass: "payload--tls-handshake",
      arrivalEvent: constants.EVENT_PACKET_ARRIVED
    },

    LEO_UPLINK: {
      id: "LEO_UPLINK",
      label: "LEO laser uplink",
      color: "#00f0ff",
      weight: 0.05,
      frequency: "EVENT_DRIVEN",
      payloadType: "LASER_TRANSFER",
      velocityFactor: 2.0,
      byteSize: {
        min: 1024,
        typical: 65536,
        max: 1048576
      },
      ttlMs: 8000,
      burst: {
        min: 1,
        max: 1
      },
      transport: "LEO_LASER",
      trajectory: "RADIAL",
      handoverState: "INSTANT",
      handoverDurationMs: constants.LASER_HANDOVER_DURATION_MS,
      cssClass: "packet--leo-uplink",
      uiClass: "payload--leo-uplink",
      arrivalEvent: constants.EVENT_PACKET_ARRIVED,
      handoverEvent: constants.EVENT_LASER_HANDOVER
    }
  };

  const packetClassIds = Object.keys(packetClasses);

  const fiberPacketClassIds = packetClassIds.filter(
    id => packetClasses[id].transport === "FIBER"
  );

  let totalWeight = 0;

  for (const id of packetClassIds) {
    const packet = packetClasses[id];
    const bytes = packet.byteSize;

    if (
      packet.id !== id ||
      !/^#[0-9a-f]{6}$/i.test(packet.color) ||
      !Number.isFinite(packet.weight) ||
      packet.weight <= 0 ||
      !Number.isFinite(packet.velocityFactor) ||
      packet.velocityFactor <= 0 ||
      !Number.isSafeInteger(bytes.min) ||
      !Number.isSafeInteger(bytes.typical) ||
      !Number.isSafeInteger(bytes.max) ||
      bytes.min <= 0 ||
      bytes.typical < bytes.min ||
      bytes.max < bytes.typical ||
      !Number.isFinite(packet.ttlMs) ||
      packet.ttlMs <= 0
    ) {
      throw new Error("Invalid packet class: " + id);
    }

    totalWeight += packet.weight;
  }

  if (Math.abs(totalWeight - 1) > 1e-9) {
    throw new Error("Packet traffic weights must sum to one.");
  }

  // Validate the entire logical graph once, before downstream consumers see it.
  const visited = new Set([stationIds[0]]);
  const queue = [stationIds[0]];

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];

    for (const routeId of adjacency[id]) {
      const route = routesById[routeId];
      const neighbor =
        route.source === id ? route.target : route.source;

      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  if (visited.size !== stationIds.length) {
    throw new Error(
      "Station registry contains a disconnected component."
    );
  }

  // Right-handed, Y-up globe: north = +Y, Greenwich = +X, 90 degrees east = -Z.
  // Three.js is needed only when this helper is called, not when the registry loads.
  // Each call returns a fresh, mutable THREE.Vector3.
  const latLonToVector3 = (
    lat,
    lon,
    radius = constants.PLANET_RADIUS
  ) => {
    if (
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180 ||
      !Number.isFinite(radius) ||
      radius < 0
    ) {
      throw new RangeError(
        "Expected latitude [-90,90], longitude [-180,180], and a nonnegative radius."
      );
    }

    const THREE = window.THREE;

    if (!THREE || typeof THREE.Vector3 !== "function") {
      throw new ReferenceError(
        "THREE.Vector3 must be loaded before latLonToVector3 is called."
      );
    }

    const latitude = lat * DEG_TO_RAD;
    const longitude = lon * DEG_TO_RAD;
    const horizontal = radius * Math.cos(latitude);

    const x = horizontal * Math.cos(longitude);
    const y = radius * Math.sin(latitude);
    const z = -horizontal * Math.sin(longitude);
    const epsilon = radius * 1e-12;

    return new THREE.Vector3(
      Math.abs(x) <= epsilon ? 0 : x,
      Math.abs(y) <= epsilon ? 0 : y,
      Math.abs(z) <= epsilon ? 0 : z
    );
  };

  function deepFreeze(value, seen = new WeakSet()) {
    if (
      value === null ||
      (
        typeof value !== "object" &&
        typeof value !== "function"
      ) ||
      seen.has(value)
    ) {
      return value;
    }

    seen.add(value);

    for (const key of Object.keys(value)) {
      deepFreeze(value[key], seen);
    }

    return Object.freeze(value);
  }

  const contract = deepFreeze({
    registryId: REGISTRY_ID,
    schemaVersion: SCHEMA_VERSION,
    title: "The Global Deep-Sea Fiber-Optic Internet Backbone",

    metadata: {
      coverage:
        "Curated global simulation registry, not an exhaustive commercial asset inventory.",
      coordinates:
        "Approximate landing-locality coordinates; gateway IDs may name a served metropolitan area.",
      tiers:
        "1 = simulation core hub; 2 = regional anchor. These are not autonomous-system peering tiers.",
      capacities:
        "Synthetic aggregate capacity budgets in Tbps; not measured or contractual cable capacities.",
      corridors:
        "Schematic logical edges; named cable corridors are abstracted and other corridors are explicitly simulated.",
      geometry:
        "Great-circle lofts are visual guides, not surveyed seabed routes. Respect via and transport when displaying composites.",
      latency:
        "One-way propagation at an assumed 200000 km/s in fiber; excludes serialization, processing, and queues.",
      packets:
        "Payload size, traffic weights, TTLs, and velocity factors are visualization settings.",
      leo:
        "The 135-unit shell exaggerates orbital height for visibility; instantaneous handover is a simulation state transition.",
      stationCount: stationIds.length,
      routeCount: routes.length
    },

    constants,
    regions,
    stations,
    stationIds,
    routes,
    routesById,
    adjacency,
    packetClasses,
    packetClassIds,
    fiberPacketClassIds,
    references,
    latLonToVector3
  });

  Object.defineProperty(engine, "DataContract", {
    value: contract,
    enumerable: true,
    writable: false,
    configurable: false
  });
})();