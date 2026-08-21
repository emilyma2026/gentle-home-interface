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

  function revisionConflictError() {
    return lifecycleError("REVISION_CONFLICT", BACKEND_MESSAGE);
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

  function isStateRow(row, expectedFamilyId, expectedCode) {
    return Boolean(
      row &&
      row.family_id === expectedFamilyId &&
      Number.isInteger(row.revision) &&
      row.revision >= 0 &&
      row.payload &&
      typeof row.payload === "object" &&
      !Array.isArray(row.payload) &&
      row.payload.code === expectedCode,
    );
  }

  function isRevisionConflict(error) {
    return Boolean(
      error && (error.code === "REVISION_CONFLICT" || error.message === "REVISION_CONFLICT"),
    );
  }

  function createSupabaseStore({ client, newFamily, onStatus, storage }) {
    let user = null;
    let state = null;
    let activeSelection = null;
    let selectedRole = null;
    let initialization = null;
    let mutationGeneration = 0;
    let activeMutations = 0;
    let nextSelectionId = 0;
    let nextOperationId = 0;
    const subscribers = [];

    function reportStatus(...status) {
      try {
        onStatus(...status);
      } catch (_error) {
        // Status observers cannot change persistence or lifecycle outcomes.
      }
    }

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
      const previousSelection = activeSelection;
      activeSelection = null;
      state = null;
      selectedRole = null;
      removeRealtimeChannel(previousSelection);
    }

    function emit() {
      [...subscribers].forEach((subscriber) => {
        try {
          subscriber(state);
        } catch (_error) {
          // Rendering observers cannot abort state reconciliation or persistence.
        }
      });
    }

    function samePayload(first, second) {
      if (first === second) return true;
      if (first === null || second === null) return false;
      if (typeof first !== "object" || typeof second !== "object") return false;
      if (Array.isArray(first) || Array.isArray(second)) {
        return Boolean(
          Array.isArray(first) &&
          Array.isArray(second) &&
          first.length === second.length &&
          first.every((value, index) => samePayload(value, second[index])),
        );
      }

      const firstKeys = Object.keys(first);
      const secondKeys = Object.keys(second);
      return Boolean(
        firstKeys.length === secondKeys.length &&
        firstKeys.every(
          (key) =>
            Object.prototype.hasOwnProperty.call(second, key) &&
            samePayload(first[key], second[key]),
        ),
      );
    }

    function createSelection(row, role) {
      return {
        id: ++nextSelectionId,
        familyId: row.family_id,
        code: row.family_code,
        role,
        confirmedRevision: Number(row.revision),
        confirmedState: row.payload,
        operations: [],
        writeQueue: Promise.resolve(),
        channel: null,
        channelHealthy: false,
        caughtUp: false,
        catchUpGeneration: 0,
      };
    }

    function removeRealtimeChannel(selection) {
      if (!selection) return;
      const previousChannel = selection.channel;
      selection.channel = null;
      selection.channelHealthy = false;
      selection.caughtUp = false;
      selection.catchUpGeneration += 1;
      if (!previousChannel) return;

      try {
        if (client.removeChannel) {
          const removal = client.removeChannel(previousChannel);
          if (removal && typeof removal.catch === "function") removal.catch(() => {});
        } else if (previousChannel.unsubscribe) {
          previousChannel.unsubscribe();
        }
      } catch (_error) {
        // A stale channel is guarded by generation and identity checks below.
      }
    }

    function adopt(row, role) {
      const previousSelection = activeSelection;
      const nextSelection = createSelection(row, role);
      activeSelection = nextSelection;
      selectedRole = role;
      state = row.payload;
      cacheSelection(nextSelection.familyId, nextSelection.code, role);
      emit();
      removeRealtimeChannel(previousSelection);
      return nextSelection;
    }

    function operationMatchesPayload(operation, row) {
      if (!operation.sentPayload || operation.expectedRevision + 1 !== Number(row.revision)) {
        return false;
      }
      const comparablePayload = structuredClone(operation.sentPayload);
      comparablePayload.rev = Number(row.revision);
      return samePayload(comparablePayload, row.payload);
    }

    function coverOperationsFromRealtime(selection, row) {
      let coveredThrough = -1;
      selection.operations.forEach((operation) => {
        if (operationMatchesPayload(operation, row)) coveredThrough = operation.id;
      });
      if (coveredThrough < 0) return;
      selection.operations.forEach((operation) => {
        if (operation.id <= coveredThrough) operation.covered = true;
      });
    }

    function reconcileConfirmed(selection, row) {
      if (!isStateRow(row, selection.familyId, selection.code)) return false;
      const nextRevision = Number(row.revision);
      if (nextRevision <= selection.confirmedRevision) return false;

      selection.confirmedRevision = nextRevision;
      selection.confirmedState = row.payload;
      coverOperationsFromRealtime(selection, row);
      return true;
    }

    function hasUnsavedOperations(selection) {
      return selection.operations.some((operation) => operation.quarantined || !operation.covered);
    }

    function projectSelection(selection, throughOperationId = Infinity) {
      const operations = selection.operations.filter(
        (operation) =>
          operation.id <= throughOperationId && !operation.covered && !operation.quarantined,
      );
      if (operations.length === 0) return selection.confirmedState;

      const draft = structuredClone(selection.confirmedState);
      operations.forEach((operation) => {
        try {
          operation.mutator(draft);
        } catch (cause) {
          const error = new Error("Unable to replay a local family-state operation.");
          error.operation = operation;
          error.cause = cause;
          throw error;
        }
      });
      return draft;
    }

    function publishSelection(selection) {
      if (selection !== activeSelection) return;
      let projectedState = null;
      while (!projectedState) {
        try {
          projectedState = projectSelection(selection);
        } catch (error) {
          if (!error.operation) {
            reportStatus("error", BACKEND_MESSAGE);
            return;
          }
          error.operation.quarantined = true;
          reportStatus("error", BACKEND_MESSAGE);
        }
      }
      if (samePayload(state, projectedState)) return;
      state = projectedState;
      emit();
    }

    function maybeReportSynced(selection) {
      if (
        selection === activeSelection &&
        selection.channelHealthy &&
        selection.caughtUp &&
        !hasUnsavedOperations(selection)
      ) {
        reportStatus("synced");
      }
    }

    async function catchUpSelection(selection, realtimeChannel) {
      if (selection !== activeSelection || selection.channel !== realtimeChannel) return;
      selection.channelHealthy = true;
      selection.caughtUp = false;
      const catchUpOperation = ++selection.catchUpGeneration;
      reportStatus(hasUnsavedOperations(selection) ? "saving" : "loading");

      const latest = await readFamilyState(selection.familyId, selection.code);
      if (
        selection !== activeSelection ||
        selection.channel !== realtimeChannel ||
        catchUpOperation !== selection.catchUpGeneration
      ) {
        return;
      }
      if (!latest.row) {
        reportStatus(latest.offline ? "offline" : "error", BACKEND_MESSAGE);
        return;
      }

      reconcileConfirmed(selection, latest.row);
      selection.caughtUp = true;
      publishSelection(selection);
      maybeReportSynced(selection);
    }

    function subscribeToFamily(selection) {
      try {
        const nextChannel = client.channel(`family-state:${selection.familyId}`);
        nextChannel.on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "family_states",
            filter: `family_id=eq.${selection.familyId}`,
          },
          (event) => {
            if (selection !== activeSelection || selection.channel !== nextChannel) return;
            const row = event && event.new;
            if (!reconcileConfirmed(selection, row)) return;
            publishSelection(selection);
            maybeReportSynced(selection);
          },
        );
        selection.channel = nextChannel;
        nextChannel.subscribe((status) => {
          if (selection !== activeSelection || selection.channel !== nextChannel) return;
          if (status === "SUBSCRIBED") return catchUpSelection(selection, nextChannel);
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            selection.channelHealthy = false;
            selection.caughtUp = false;
            selection.catchUpGeneration += 1;
            reportStatus("offline", BACKEND_MESSAGE);
          }
        });
      } catch (_error) {
        selection.channelHealthy = false;
        selection.caughtUp = false;
        reportStatus("offline", BACKEND_MESSAGE);
      }
    }

    function startRealtime(selection) {
      subscribeToFamily(selection);
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
      reportStatus("connecting");

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

        reportStatus("synced");
        return user;
      } catch (error) {
        reportStatus("error", errorMessage(error));
        initialization = null;
        throw error;
      }
    }

    async function create(lang) {
      const operation = ++mutationGeneration;
      activeMutations += 1;
      try {
        await initialize();
        if (operation !== mutationGeneration) return null;
        reportStatus("loading");

        let result;
        try {
          result = await client.rpc("create_family", {
            initial_payload: newFamily("", lang),
            requested_role: "family",
          });
        } catch (_error) {
          result = { data: null, error: true };
        }
        if (operation !== mutationGeneration) return null;

        const row = singleRow(result.data);
        if (result.error || !isRpcRow(row)) {
          const error = backendError();
          reportStatus("error", error.message);
          throw error;
        }

        const selection = adopt(row, "family");
        startRealtime(selection);
        return row.family_code;
      } finally {
        activeMutations -= 1;
      }
    }

    async function attach(code, selectedRole) {
      const normalizedCode = String(code ?? "").trim();
      if (!isFamilyCode(normalizedCode)) {
        throw lifecycleError("FAMILY_NOT_FOUND", "Family not found.");
      }
      if (!isFamilyRole(selectedRole)) throw backendError();

      const operation = ++mutationGeneration;
      activeMutations += 1;
      try {
        await initialize();
        if (operation !== mutationGeneration) return state;
        reportStatus("loading");

        let result;
        try {
          result = await client.rpc("join_family", {
            family_code: normalizedCode,
            requested_role: selectedRole,
          });
        } catch (_error) {
          result = { data: null, error: true };
        }
        if (operation !== mutationGeneration) return state;

        if (result.error) {
          const error = backendError();
          reportStatus("error", error.message);
          throw error;
        }

        const row = singleRow(result.data);
        if (!row) {
          const error = lifecycleError("FAMILY_NOT_FOUND", "Family not found.");
          reportStatus("error", error.message);
          throw error;
        }
        if (!isRpcRow(row)) {
          const error = backendError();
          reportStatus("error", error.message);
          throw error;
        }

        const membershipResult = await readMembership(row.family_id, row.family_code);
        if (operation !== mutationGeneration) return state;
        const { membership, valid } = validMembership(
          membershipResult,
          row.family_id,
          row.family_code,
        );
        if (!valid) {
          const error = backendError();
          reportStatus("error", error.message);
          throw error;
        }

        const selection = adopt(row, membership.role);
        startRealtime(selection);
        return state;
      } finally {
        activeMutations -= 1;
      }
    }

    async function restoreSelection() {
      const operation = mutationGeneration;
      if (activeMutations > 0) return state;
      const cachedFamilyId = readSelection(FAMILY_ID_KEY);
      const cachedCode = readSelection(FAMILY_CODE_KEY);
      const cachedRole = readSelection(FAMILY_ROLE_KEY);

      if (!isFamilyId(cachedFamilyId) || !isFamilyCode(cachedCode) || !isFamilyRole(cachedRole)) {
        clearSelection();
        return null;
      }

      await initialize();
      if (operation !== mutationGeneration) return state;
      reportStatus("loading");

      const membershipResult = await readMembership(cachedFamilyId, cachedCode);
      if (operation !== mutationGeneration) return state;

      if (membershipResult.error) {
        const error = backendError();
        reportStatus("error", error.message);
        throw error;
      }

      const { membership, valid } = validMembership(membershipResult, cachedFamilyId, cachedCode);
      if (!valid || membership.role !== cachedRole) {
        clearSelection();
        reportStatus("synced");
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
      if (operation !== mutationGeneration) return state;

      const row = singleRow(stateResult.data);
      const restoredRow = row && { ...row, family_code: cachedCode };
      if (stateResult.error || !isRpcRow(restoredRow)) {
        const error = backendError();
        reportStatus("error", error.message);
        throw error;
      }

      const selection = adopt(restoredRow, cachedRole);
      startRealtime(selection);
      return state;
    }

    async function callReplace(selection, expectedRevision, nextPayload) {
      try {
        return {
          offline: false,
          result: await client.rpc("replace_family_state", {
            target_family_id: selection.familyId,
            expected_revision: expectedRevision,
            next_payload: nextPayload,
          }),
        };
      } catch (_error) {
        return { offline: true, result: { data: null, error: true } };
      }
    }

    async function readFamilyState(targetFamilyId, selectedCode) {
      let result;
      try {
        result = await client
          .from("family_states")
          .select("family_id, revision, payload")
          .eq("family_id", targetFamilyId)
          .maybeSingle();
      } catch (_error) {
        return { offline: true, row: null };
      }

      const row = singleRow(result.data);
      if (result.error || !isStateRow(row, targetFamilyId, selectedCode)) {
        return { offline: false, row: null };
      }
      return { offline: false, row };
    }

    function reportWriteFailure(selection, status, error) {
      if (selection === activeSelection) reportStatus(status, error.message);
      return error;
    }

    function rejectIfQuarantined(selection, operation) {
      if (operation.quarantined) {
        throw reportWriteFailure(selection, "error", backendError());
      }
    }

    function settleQuarantinedOperation(selection, operation) {
      if (!operation.quarantined) return;
      selection.operations = selection.operations.filter((candidate) => candidate !== operation);
      publishSelection(selection);
    }

    function acceptedWriteRow(row, selection, expectedRevision) {
      return Boolean(
        isRpcRow(row) &&
        row.family_id === selection.familyId &&
        Number(row.revision) > expectedRevision,
      );
    }

    function settleThrough(selection, operation) {
      selection.operations = selection.operations.filter(
        (candidate) => candidate.id > operation.id,
      );
    }

    function optimisticDependencies(selection, operationId = Infinity) {
      return selection.operations
        .filter(
          (candidate) => candidate.id < operationId && !candidate.covered && !candidate.quarantined,
        )
        .map((candidate) => candidate.id);
    }

    function hasValidOptimisticDraft(selection, operation) {
      if (selection.confirmedRevision !== operation.baseRevision) return false;
      const dependencies = optimisticDependencies(selection, operation.id);
      return (
        dependencies.length === operation.optimisticDependencies.length &&
        dependencies.every(
          (dependencyId, index) => dependencyId === operation.optimisticDependencies[index],
        )
      );
    }

    function prepareAttempt(selection, operation) {
      let nextPayload;
      if (hasValidOptimisticDraft(selection, operation)) {
        nextPayload = operation.optimisticDraft;
      } else {
        nextPayload = projectSelection(selection, operation.id);
      }
      operation.state = "writing";
      operation.expectedRevision = selection.confirmedRevision;
      operation.sentPayload = nextPayload;
      return { expectedRevision: operation.expectedRevision, nextPayload };
    }

    function acceptWrite(selection, operation, row, expectedRevision) {
      if (!acceptedWriteRow(row, selection, expectedRevision)) throw backendError();
      reconcileConfirmed(selection, row);
      settleThrough(selection, operation);
      publishSelection(selection);
      maybeReportSynced(selection);
      return row.payload;
    }

    function acceptRealtimeCoveredWrite(selection, operation) {
      settleThrough(selection, operation);
      publishSelection(selection);
      maybeReportSynced(selection);
      return selection.confirmedState;
    }

    function leaveOperationUnsaved(selection, operation, status, error) {
      operation.state = "unsaved";
      publishSelection(selection);
      throw reportWriteFailure(selection, status, error);
    }

    async function recoverAfterRetryFailure(selection, operation, retry) {
      const recovery = await readFamilyState(selection.familyId, selection.code);
      if (recovery.row) reconcileConfirmed(selection, recovery.row);

      settleThrough(selection, operation);
      publishSelection(selection);
      const retryError = isRevisionConflict(retry.result.error)
        ? revisionConflictError()
        : backendError();
      const status = retry.offline || recovery.offline ? "offline" : "error";
      throw reportWriteFailure(selection, status, retryError);
    }

    async function persistUpdate(selection, operation) {
      rejectIfQuarantined(selection, operation);

      let firstPayload;
      try {
        firstPayload = prepareAttempt(selection, operation);
      } catch (_error) {
        return leaveOperationUnsaved(selection, operation, "error", backendError());
      }

      rejectIfQuarantined(selection, operation);
      const firstAttempt = await callReplace(
        selection,
        firstPayload.expectedRevision,
        firstPayload.nextPayload,
      );
      rejectIfQuarantined(selection, operation);
      if (operation.covered) return acceptRealtimeCoveredWrite(selection, operation);

      if (!firstAttempt.result.error) {
        const row = singleRow(firstAttempt.result.data);
        if (acceptedWriteRow(row, selection, firstPayload.expectedRevision)) {
          return acceptWrite(selection, operation, row, firstPayload.expectedRevision);
        }
        return leaveOperationUnsaved(selection, operation, "error", backendError());
      }

      if (!isRevisionConflict(firstAttempt.result.error)) {
        return leaveOperationUnsaved(
          selection,
          operation,
          firstAttempt.offline ? "offline" : "error",
          backendError(),
        );
      }

      const freshResult = await readFamilyState(selection.familyId, selection.code);
      if (freshResult.row) reconcileConfirmed(selection, freshResult.row);
      if (!freshResult.row || selection.confirmedRevision <= firstPayload.expectedRevision) {
        return leaveOperationUnsaved(
          selection,
          operation,
          freshResult.offline ? "offline" : "error",
          backendError(),
        );
      }
      publishSelection(selection);
      rejectIfQuarantined(selection, operation);

      let retryPayload;
      try {
        retryPayload = prepareAttempt(selection, operation);
      } catch (_error) {
        return leaveOperationUnsaved(selection, operation, "error", backendError());
      }
      rejectIfQuarantined(selection, operation);
      const retry = await callReplace(
        selection,
        retryPayload.expectedRevision,
        retryPayload.nextPayload,
      );
      rejectIfQuarantined(selection, operation);
      if (operation.covered) return acceptRealtimeCoveredWrite(selection, operation);

      if (!retry.result.error) {
        const row = singleRow(retry.result.data);
        if (acceptedWriteRow(row, selection, retryPayload.expectedRevision)) {
          return acceptWrite(selection, operation, row, retryPayload.expectedRevision);
        }
      }

      return recoverAfterRetryFailure(selection, operation, retry);
    }

    function update(mutator) {
      const selection = activeSelection;
      if (!state || !selection || typeof mutator !== "function") {
        const error = backendError();
        reportStatus("error", error.message);
        return Promise.reject(error);
      }

      let optimisticDraft;
      try {
        optimisticDraft = structuredClone(state);
        mutator(optimisticDraft);
      } catch (_error) {
        const error = backendError();
        reportStatus("error", error.message);
        return Promise.reject(error);
      }

      const operation = {
        id: ++nextOperationId,
        mutator,
        baseRevision: selection.confirmedRevision,
        optimisticDraft,
        optimisticDependencies: optimisticDependencies(selection),
        covered: false,
        state: "queued",
        expectedRevision: -1,
        sentPayload: null,
      };
      selection.operations.push(operation);
      state = optimisticDraft;
      reportStatus("saving");
      emit();

      const persistence = selection.writeQueue.then(() => persistUpdate(selection, operation));
      const settlement = persistence.finally(() => {
        settleQuarantinedOperation(selection, operation);
      });
      selection.writeQueue = settlement.catch(() => {});
      return settlement;
    }

    function resetFamily() {
      if (!state || !activeSelection) return update(null);
      const freshState = newFamily(state.code, state.lang || "zh");
      return update((draft) => {
        Object.keys(draft).forEach((key) => delete draft[key]);
        Object.assign(draft, structuredClone(freshState));
      });
    }

    async function signOut() {
      mutationGeneration += 1;
      clearSelection();
      emit();
      reportStatus("synced");
    }

    return {
      initialize,
      create,
      attach,
      restoreSelection,
      update,
      resetFamily,
      signOut,
      get: () => state,
      role: () => selectedRole,
      subscribe: (subscriber) => {
        subscribers.push(subscriber);
        return () => {
          const index = subscribers.indexOf(subscriber);
          if (index >= 0) subscribers.splice(index, 1);
        };
      },
    };
  }

  global.createSupabaseStore = createSupabaseStore;
})(typeof window === "undefined" ? globalThis : window);
