from fastapi import Depends, File, Form, HTTPException, Path, Query, UploadFile
from sqlalchemy.orm import Session, joinedload, selectinload
from typing import List, Optional
from sqlalchemy import desc, case, func, cast, Date
from datetime import datetime, timedelta, timezone
import logging
import re

from .. import crud, schemas, auth, rbac, models
from ..feature_guard import require_project_feature
from ..database import get_db
from ..auth import get_current_active_user, get_current_user
from ..models import TestCase, TestResult, TestRun, User, TestCaseRevision, ResultStatus, canonical_result_status
from .test_management_helpers import *

logger = logging.getLogger(__name__)


def register_analysis_routes(app):
    @app.post("/test-mindmaps/", response_model=schemas.TestMindmap)
    def create_test_mindmap(
        mindmap: schemas.TestMindmapCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", mindmap.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.create_test_mindmap(db=db, mindmap=mindmap.model_dump())

    @app.get("/test-mindmaps/", response_model=List[schemas.TestMindmap])
    def read_test_mindmaps(
        project_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.get_test_mindmaps(db, project_id=project_id, skip=skip, limit=limit)

    @app.get("/test-mindmaps/{mindmap_id}", response_model=schemas.TestMindmap)
    def read_test_mindmap(
        mindmap_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        mindmap = crud.get_test_mindmap(db, mindmap_id=mindmap_id)
        if mindmap is None:
            raise HTTPException(status_code=404, detail="Test mindmap not found")
        
        if not rbac.has_permission(current_user, "read", mindmap.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return mindmap

    @app.put("/test-mindmaps/{mindmap_id}", response_model=schemas.TestMindmap)
    def update_test_mindmap(
        mindmap_id: int,
        mindmap: schemas.TestMindmapUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_mindmap = crud.get_test_mindmap(db, mindmap_id=mindmap_id)
        if db_mindmap is None:
            raise HTTPException(status_code=404, detail="Test mindmap not found")
        
        if not rbac.has_permission(current_user, "write", db_mindmap.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.update_test_mindmap(db, mindmap_id=mindmap_id, mindmap=mindmap.model_dump(exclude_unset=True))

    @app.delete("/test-mindmaps/{mindmap_id}", response_model=schemas.MessageResponse)
    def delete_test_mindmap(
        mindmap_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_mindmap = crud.get_test_mindmap(db, mindmap_id=mindmap_id)
        if db_mindmap is None:
            raise HTTPException(status_code=404, detail="Test mindmap not found")
        
        if not rbac.has_permission(current_user, "delete", db_mindmap.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        crud.delete_test_mindmap(db, mindmap_id=mindmap_id)
        return {"message": "Test mindmap deleted successfully"}

    @app.post("/impact-analyses/", response_model=schemas.ImpactAnalysis)
    def create_impact_analysis(
        analysis: schemas.ImpactAnalysisCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", analysis.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.create_impact_analysis(db=db, analysis=analysis.model_dump())

    @app.get("/impact-analyses/", response_model=List[schemas.ImpactAnalysis])
    def read_impact_analyses(
        project_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.get_impact_analyses(db, project_id=project_id, skip=skip, limit=limit)

    @app.get("/impact-analyses/{analysis_id}", response_model=schemas.ImpactAnalysis)
    def read_impact_analysis(
        analysis_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        analysis = crud.get_impact_analysis(db, analysis_id=analysis_id)
        if analysis is None:
            raise HTTPException(status_code=404, detail="Impact analysis not found")
        
        if not rbac.has_permission(current_user, "read", analysis.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return analysis

    @app.put("/impact-analyses/{analysis_id}", response_model=schemas.ImpactAnalysis)
    def update_impact_analysis(
        analysis_id: int,
        analysis: schemas.ImpactAnalysisUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_analysis = crud.get_impact_analysis(db, analysis_id=analysis_id)
        if db_analysis is None:
            raise HTTPException(status_code=404, detail="Impact analysis not found")
        
        if not rbac.has_permission(current_user, "write", db_analysis.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.update_impact_analysis(db, analysis_id=analysis_id, analysis=analysis.model_dump(exclude_unset=True))

    @app.delete("/impact-analyses/{analysis_id}", response_model=schemas.MessageResponse)
    def delete_impact_analysis(
        analysis_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_analysis = crud.get_impact_analysis(db, analysis_id=analysis_id)
        if db_analysis is None:
            raise HTTPException(status_code=404, detail="Impact analysis not found")
        
        if not rbac.has_permission(current_user, "delete", db_analysis.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        crud.delete_impact_analysis(db, analysis_id=analysis_id)
        return {"message": "Impact analysis deleted successfully"}

    @app.post("/impact-analyses/generate")
    def generate_impact_analysis(
        test_case_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if not test_case:
            raise HTTPException(status_code=404, detail="Test case not found")
        
        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not rbac.has_permission(current_user, "read", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Generate impact analysis (simplified version)
        analysis = crud.create_impact_analysis(db, analysis={
            "title": f"Impact Analysis for Test Case {test_case_id}",
            "project_id": test_suite.project_id,
            "created_by": current_user.id,
            "affected_test_cases": [test_case_id]
        })
        return analysis
