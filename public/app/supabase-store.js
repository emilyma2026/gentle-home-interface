(function (global) {
  const FAMILY_ID_KEY = "alz:family-id";
  const FAMILY_CODE_KEY = "alz:code";
  const FAMILY_ROLE_KEY = "alz:role";
  const BACKEND_MESSAGE = "Unable to connect to your family right now.";

  function errorMessage(error) {
    return error && error.message ? error.message : "Unable to initialize Supabase authentication.";
  }

  function lifecycleError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function backendError() {
    return lifecycleError("BACKEND_ERROR", BACKEND_MESSAGE);
  }

  function singleRow(data) {
    return Array.isArray(data) ? data[0] || null : data || null;
  }

  function isFamilyId(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "");
  }

  function isFamilyCode(value) {
    return /^[0-9]{6}$/.test(value || "");
  }

  function isFamilyRole(value) {
    return value === "family" || value === "elder";
  }

  function isRpcRow(row) {
    return Boolean(
      row &&
      isFamilyId(row.family_id) &&
      isFamilyCode(row.family_code) &&
      Number.isInteger(row.revision) &&
      row.revision >= 0 &&
      row.payload &&
      typeof row.payload === "object" &&
      !Array.isArray(row.payload) &&
      row.payload.code === row.family_code,
    );
  }

  function createSupabaseStore({ client, newFamily, onStatus, storage }) {
    let user = null;
    let state = null;
    let familyId = null;
    let revision = -1;
    let selectedRole = null;
    let channel = null;
    let initialization = null;
    let lifecycleGeneration = 0;
    const subscribers = [];

    function readSelection(key) {
      if (!storage) return null;
      try {
        return storage.getItem ? storage.getItem(key) : storage.get(key) || null;
      } catch (_error) {
        return null;
      }
    }

    function writeSelection(key, value) {
      if (!storage) return;
      if (storage.setItem) storage.setItem(key, value);
      else storage.set(key, value);
    }

    function removeSelection(key) {
      if (!storage) return;
      if (storage.removeItem) storage.removeItem(key);
      else storage.delete(key);
    }

    function clearCachedSelection() {
      [FAMILY_ID_KEY, FAMILY_CODE_KEY, FAMILY_ROLE_KEY].forEach((key) => {
        try {
          removeSelection(key);
        } catch (_error) {
          // Selection caching is best-effort and never the family-data source of truth.
        }
      });
    }

    function cacheSelection(selectedFamilyId, selectedCode, role) {
      try {
        writeSelection(FAMILY_ID_KEY, selectedFamilyId);
        writeSelection(FAMILY_CODE_KEY, selectedCode);
        writeSelection(FAMILY_ROLE_KEY, role);
      } catch (_error) {
        clearCachedSelection();
      }
    }

    function clearSelection() {
      clearCachedSelection();
      familyId = null;
      revision = -1;
      state = null;
      selectedRole = null;
    }

    function emit() {
      subscribers.forEach((subscriber) => subscriber(state));
    }

    function adopt(row, role) {
      familyId = row.family_id;
      revision = Number(row.revision);
      state = row.payload;
      selectedRole = role;
      cacheSelection(familyId, row.family_code, role);
      emit();
    }

    async function readMembership(selectedFamilyId, selectedCode) {
      try {
        return await client
          .from("family_members")
          .select("family_id, role, families!inner(code)")
          .eq("family_id", selectedFamilyId)
          .eq("user_id", user.id)
          .eq("families.code", selectedCode)
          .maybeSingle();
      } catch (_error) {
        return { data: null, error: true };
      }
    }

    function validMembership(result, selectedFamilyId, selectedCode) {
      const membership = singleRow(result.data);
      const membershipCode = Array.isArray(membership?.families)
        ? membership.families[0]?.code
        : membership?.families?.code;
      return {
        membership,
        valid: Boolean(
          !result.error &&
          membership &&
          membership.family_id === selectedFamilyId &&
          isFamilyRole(membership.role) &&
          membershipCode === selectedCode,
        ),
      };
    }

    function initialize() {
      if (initialization) return initialization;

      initialization = initializeSession();
      return initialization;
    }

    async function initializeSession() {
      onStatus("connecting");

      try {
        const sessionResult = await client.auth.getSession();
        if (sessionResult.error) throw sessionResult.error;

        if (sessionResult.data.session?.user) {
          user = sessionResult.data.session.user;
        } else {
          const signInResult = await client.auth.signInAnonymously();
          if (signInResult.error) throw signInResult.error;
          user = signInResult.data.user;
        }

        if (!user) throw new Error("Anonymous authentication did not return a user.");

        onStatus("synced");
        return user;
      } catch (error) {
        onStatus("error", errorMessage(error));
        initialization = null;
        throw error;
      }
    }

    async function create(lang) {
      const operation = ++lifecycleGeneration;
      await initialize();
      if (operation !== lifecycleGeneration) return null;
      onStatus("loading");

      let result;
      try {
        result = await client.rpc("create_family", {
          initial_payload: newFamily("", lang),
          requested_role: "family",
        });
      } catch (_error) {
        result = { data: null, error: true };
      }
      if (operation !== lifecycleGeneration) return null;

      const row = singleRow(result.data);
      if (result.error || !isRpcRow(row)) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      adopt(row, "family");
      onStatus("synced");
      return row.family_code;
    }

    async function attach(code, selectedRole) {
      const normalizedCode = String(code ?? "").trim();
      if (!isFamilyCode(normalizedCode)) {
        throw lifecycleError("FAMILY_NOT_FOUND", "Family not found.");
      }
      if (!isFamilyRole(selectedRole)) throw backendError();

      const operation = ++lifecycleGeneration;
      await initialize();
      if (operation !== lifecycleGeneration) return state;
      onStatus("loading");

      let result;
      try {
        result = await client.rpc("join_family", {
          family_code: normalizedCode,
          requested_role: selectedRole,
        });
      } catch (_error) {
        result = { data: null, error: true };
      }
      if (operation !== lifecycleGeneration) return state;

      if (result.error) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      const row = singleRow(result.data);
      if (!row) {
        const error = lifecycleError("FAMILY_NOT_FOUND", "Family not found.");
        onStatus("error", error.message);
        throw error;
      }
      if (!isRpcRow(row)) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      const membershipResult = await readMembership(row.family_id, row.family_code);
      if (operation !== lifecycleGeneration) return state;
      const { membership, valid } = validMembership(
        membershipResult,
        row.family_id,
        row.family_code,
      );
      if (!valid) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      adopt(row, membership.role);
      onStatus("synced");
      return state;
    }

    async function restoreSelection() {
      const operation = ++lifecycleGeneration;
      const cachedFamilyId = readSelection(FAMILY_ID_KEY);
      const cachedCode = readSelection(FAMILY_CODE_KEY);
      const cachedRole = readSelection(FAMILY_ROLE_KEY);

      if (!isFamilyId(cachedFamilyId) || !isFamilyCode(cachedCode) || !isFamilyRole(cachedRole)) {
        clearSelection();
        return null;
      }

      await initialize();
      if (operation !== lifecycleGeneration) return state;
      onStatus("loading");

      const membershipResult = await readMembership(cachedFamilyId, cachedCode);
      if (operation !== lifecycleGeneration) return state;

      if (membershipResult.error) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      const { membership, valid } = validMembership(membershipResult, cachedFamilyId, cachedCode);
      if (!valid || membership.role !== cachedRole) {
        clearSelection();
        onStatus("synced");
        return null;
      }

      let stateResult;
      try {
        stateResult = await client
          .from("family_states")
          .select("family_id, revision, payload")
          .eq("family_id", cachedFamilyId)
          .maybeSingle();
      } catch (_error) {
        stateResult = { data: null, error: true };
      }
      if (operation !== lifecycleGeneration) return state;

      const row = singleRow(stateResult.data);
      const restoredRow = row && { ...row, family_code: cachedCode };
      if (stateResult.error || !isRpcRow(restoredRow)) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      adopt(restoredRow, cachedRole);
      onStatus("synced");
      return state;
    }

    return {
      initialize,
      create,
      attach,
      restoreSelection,
      get: () => state,
      role: () => selectedRole,
      subscribe: (subscriber) => subscribers.push(subscriber),
    };
  }

  global.createSupabaseStore = createSupabaseStore;
})(typeof window === "undefined" ? globalThis : window);
