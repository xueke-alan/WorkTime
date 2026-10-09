"use strict";
/**
 * Runtime data contracts. Minutes are the internal unit; missing and null do not mean zero.
 * OA raw fields store compact date/weekday/punch/status evidence, not full page text.
 * @typedef {{start:number,end:number}} WorkBreak
 * @typedef {{configured:boolean,workStart:string,workEnd:string,standardMinutes:number,breaks:WorkBreak[]}} WorkSettings
 * @typedef {{employmentDate:string,workCity:string}} WorkPersonal
 * @typedef {{pageTheme:'green'|'blue'|'purple'|'orange'|'rose'|'slate'|'cyan'|'mint'|'olive'|'gold'|'red'|'brown',forecastMode?:'hourly'|'daily'}} WorkPreferences
 * @typedef {{id:string,order?:number,data:Object}} ArchiveRecord
 * @typedef {{id:string,version:number,records:ArchiveRecord[]}} ArchiveModule
 * @typedef {{format:'worktime-archive',formatVersion:1,archive:{id:string,createdAt:string},modules:ArchiveModule[],exportedAt?:string}} WorkArchive
 * @typedef {{load:function():Promise<Object>,commit:function(Object,Object):Promise<WorkOperationResult>,restore:function(Object):Promise<WorkOperationResult>,export:function(Object):Promise<WorkArchive>}} WorkPersistence
 * @typedef {{start:string,end:string,nextDay:boolean,effectiveMinutes:number|null}} WorkManualRecord
 * @typedef {{start:string,end:string,nextDay:boolean}} WorkDraft
 * @typedef {{date:string,start:string,end:string,nextDay:boolean,status:'complete'|'pending'|'off',source:string,raw:string,importId?:string}} WorkOAObservation
 * @typedef {{oa?:WorkOAObservation,actual?:WorkManualRecord,estimate?:WorkManualRecord,draft?:WorkDraft,kind?:'work'|'rest',leaveMinutes?:number,note?:string,plannedOvertime?:boolean}} WorkDay
 * @typedef {{name:string,raw:string}} WorkImportSource
 * @typedef {{id:string,at:string,year:number,sources:WorkImportSource[],count:number,records:WorkOAObservation[]}} WorkImportLog
 * @typedef {'ADDED'|'DUPLICATE'|'KEEP_COMPLETE'|'COMPLETE_CONFLICT'|'COMPLETED'|'KEEP_START'|'UPDATED'} WorkImportMergeCode
 * @typedef {{record:WorkOAObservation,code:WorkImportMergeCode,conflict?:boolean}} WorkObservationMerge
 * @typedef {{id:string,name:string,start:string,end:string,nextDay:boolean}} WorkTimeTemplate
 * @typedef {{workStart:string,workEnd:string,standardMinutes:number,breaks:WorkBreak[]}} WorkScheduleData
 * @typedef {{start:string,end:string|null,schedule:WorkScheduleData}} WorkScheduleRange
 * @typedef {{scheduleRanges:WorkScheduleRange[],schemaVersion:3,personal:WorkPersonal,preferences:WorkPreferences,overtimeRequirements:(number|null)[],oaUrl:string,settings:WorkSettings,timeTemplates:WorkTimeTemplate[],days:Object<string,WorkDay>,imports:WorkImportLog[]}} WorkStateData
 * @typedef {{today:string,month:string,selected:string,batchMode:boolean,batchDays:Set<string>,yearMode:boolean,viewYear:number}} WorkViewState
 * @typedef {'unavailable'|'unsupported'|'corrupt'|null} WorkStorageLoadIssue
 * @typedef {WorkViewState & {state:WorkStateData,revision:number,storageFailed:boolean,loadCorrupt:boolean,loadIssue:WorkStorageLoadIssue,batchAnchor:string|null,returnMonth:string}} WorkApplicationModel
 * @typedef {{core:Object,element:function(string):HTMLElement,escape:function(*):string,getState:function():WorkStateData,getView:function():WorkViewState,document:Document,window:Window}} WorkViewDependencies
 * @typedef {{changed:boolean,applied:boolean,persisted:boolean,dirty:boolean,code:string|null,message:string,error:Error|null}} WorkOperationResult
 *
 * OA status 'off' is an observation with no punches, not an implicit personal leave.
 * actual overrides OA; estimate is manual filling and may apply to past dates.
 * draft preserves incomplete edits and suppresses effective minutes until completed.
 * Only manual records accept non-null effectiveMinutes; 0 is a valid correction.
 * Every import contains explicit accepted records; [] means no accepted records. Raw text is never replayed by the runtime.
 * Schema 3 is only the internal calculation projection. Persisted data uses WorkArchive.
 * Internal _archive retains extension metadata; _lazy import details must hydrate before replay/export.
 * overtimeRequirements contains five tiers in minutes; null means not configured.
 * UI accepts tenths of an hour; backup requirements retain finite precision without rounding.
 */
